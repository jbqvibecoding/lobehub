/**
 * The OpenAI-compatible stand-in model (`startFakeModel`) and how it decides what to answer; see
 * `./index.ts` for what it does in each smoke run.
 */
import { createServer, type ServerResponse } from 'node:http';

import { listen, readJson, textOf } from './utils';

export const CODE_TOOL = 'lobe-cloud-sandbox____executeCode';
export const REMIND_TOOL = 'lobe-reminders____addReminder';
export const SPEAK_TOOL = 'lobe-group-management____speak';
export const BROADCAST_TOOL = 'lobe-group-management____broadcast';
export const MAIL_SEARCH_TOOL = 'lobe-mail____searchMail';
export const MAIL_READ_TOOL = 'lobe-mail____readMail';
export const MAIL_SEND_TOOL = 'lobe-mail____sendMail';
export const FREE_TIME_TOOL = 'lobe-calendar____findFreeTime';
export const CREATE_EVENT_TOOL = 'lobe-calendar____createEvent';
export const computerTool = (api: string) => `lobe-computer____${api}`;
export const profileTool = (api: string) => `lobe-profile____${api}`;
export const sandboxTool = (api: string) => `lobe-cloud-sandbox____${api}`;
const HOUR = 60 * 60 * 1000;

/** Tomorrow at an hour in mainland China (UTC+8, no daylight saving), with its offset. */
export const tomorrowInChina = (hour: number) => {
  const now = new Date(Date.now() + 8 * HOUR);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return `${day.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00+08:00`;
};

/** The expert names the fake model knows, in both languages, as their prompts introduce them. */
const EXPERT_NAMES: Record<string, string[]> = {
  Coder: ['Coder', '编程助手'],
  Researcher: ['Researcher', '研究员'],
  Writer: ['Writer', '写手'],
};

/** Which expert a request runs as: their prompt opens with "You are Researcher, …". */
const expertSpeaking = (messages: ModelRequest['messages']) => {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => textOf(message.content))
    .join('\n');
  return Object.keys(EXPERT_NAMES).find((name) => system.includes(`You are ${name},`));
};

/** A group member's id, from the group context in the host's prompt, by any of their names. */
const memberId = (messages: ModelRequest['messages'], names: string[]) => {
  const prompt = messages.map((message) => textOf(message.content)).join('\n');
  for (const name of names) {
    const patterns = [
      new RegExp(`name="${name}"[^>]*\\bid="([^"]+)"`),
      new RegExp(`\\bid="([^"]+)"[^>]*(?:name|title)="${name}"`),
      new RegExp(`\\bid="([^"]+)"[^>]*>${name}\\b`),
    ];
    for (const pattern of patterns) {
      const found = pattern.exec(prompt)?.[1];
      if (found) return found;
    }
  }
};

/**
 * What the fake model notes when Biber offers its reminders tool: "Remind me to <x>" asks for a
 * reminder two minutes from now; "my interview is …" makes Biber note a follow-up for tomorrow.
 */
const reminderFor = (said: string) => {
  const asked = /^remind me to (.+?)\.?$/i.exec(said.trim());
  if (asked) {
    return {
      about: asked[1],
      at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      kind: 'asked',
    };
  }
  if (/my interview is/i.test(said)) {
    return {
      about: 'The job interview',
      at: new Date(Date.now() + 24 * HOUR).toISOString(),
      kind: 'follow_up',
    };
  }
};

type Reply = { text: string } | { toolCall: { arguments: string; name: string } };

const callTool = (name: string, args: object): Reply => ({
  toolCall: { arguments: JSON.stringify(args), name },
});

/**
 * With the user's mailbox: "check my latest mail" ("看看最新的邮件") searches, then reads the
 * newest; "reply to that mail" ("回复这封邮件") replies "Got it" to the mail read before, to its
 * sender.
 */
const mailStep = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply | undefined => {
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const said = textOf(request.messages[lastUser]?.content);
  const results = request.messages
    .slice(lastUser + 1)
    .filter((m) => m.role === 'tool')
    .map((m) => textOf(m.content));

  if (/latest mail|最新的邮件/i.test(said) && request.tools.includes(MAIL_SEARCH_TOOL)) {
    if (results.length === 0) return callTool(MAIL_SEARCH_TOOL, { limit: 1 });
    const id = /- id (\S+)/.exec(results[0])?.[1];
    if (results.length === 1 && id) return callTool(MAIL_READ_TOOL, { id });
    return { text: 'That is your latest mail.' };
  }

  if (/reply to that mail|回复这封邮件/i.test(said) && request.tools.includes(MAIL_SEND_TOOL)) {
    if (results.length > 0) return { text: 'Replied.' };
    const earlier = request.messages
      .slice(0, lastUser)
      .map((m) => textOf(m.content))
      .join('\n');
    const id = [...earlier.matchAll(/- id (\S+:\d+)/g)].at(-1)?.[1];
    const sender = [...earlier.matchAll(/^From: (.+)$/gm)].at(-1)?.[1];
    const from = sender && /[\w.+-]+@[\w.-]+/.exec(sender)?.[0];
    if (id && from) {
      return callTool(MAIL_SEND_TOOL, { body: 'Got it, thanks.', replyToId: id, to: [from] });
    }
  }
};

/**
 * With the user's calendar, in mainland China time: "am I free tomorrow afternoon" ("明天下午有空
 * 吗") looks for free time from 13:00 to 18:00; "a meeting tomorrow at 3" ("明天下午三点建个会")
 * creates one from 15:00 to 16:00.
 */
const calendarStep = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply | undefined => {
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const said = textOf(request.messages[lastUser]?.content);
  const answered = request.messages.slice(lastUser + 1).some((m) => m.role === 'tool');

  if (
    /free tomorrow afternoon|明天下午有空/i.test(said) &&
    request.tools.includes(FREE_TIME_TOOL)
  ) {
    if (answered) return { text: 'Those are your free times.' };
    return callTool(FREE_TIME_TOOL, { from: tomorrowInChina(13), to: tomorrowInChina(18) });
  }
  if (
    /meeting tomorrow at 3|明天下午三点建个会/i.test(said) &&
    request.tools.includes(CREATE_EVENT_TOOL)
  ) {
    if (answered) return { text: 'The meeting is on your calendar.' };
    return callTool(CREATE_EVENT_TOOL, {
      end: tomorrowInChina(16),
      start: tomorrowInChina(15),
      title: 'Project sync',
    });
  }
};

/** What an interview answer saves: "叫我小安" / "call me An", a goal, someone close, a project. */
const PROFILE_ANSWERS: {
  pattern: RegExp;
  section: string;
  text: (match: RegExpExecArray) => string;
}[] = [
  { pattern: /^(?:叫我|call me )(.+?)[!.。！]?$/i, section: 'name', text: (m) => m[1] },
  { pattern: /^(?:我的目标是|my goal is to )(.+?)[.。]?$/i, section: 'goals', text: (m) => m[1] },
  { pattern: /^((?:我太太|my wife ).+?)[.。]?$/i, section: 'people', text: (m) => m[1] },
  { pattern: /^(?:我在做|i am working on )(.+?)[.。]?$/i, section: 'projects', text: (m) => m[1] },
];

/**
 * Biber with its profile tool:
 * - in the "About you" interview (its instructions are in the request), it asks for the first
 *   section still to ask, saves each answer, and on "先到这" / "that's enough" sums up and
 *   finishes the interview;
 * - answering a profile check in the "From Biber" chat, "还是这样" / "still holds" confirms the
 *   entry the check quoted.
 */
const profileStep = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply | undefined => {
  if (!request.tools.includes(profileTool('saveEntry'))) return;
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const said = textOf(request.messages[lastUser]?.content).trim();
  const results = request.messages
    .slice(lastUser + 1)
    .filter((m) => m.role === 'tool')
    .map((m) => textOf(m.content));
  const prompt = request.messages.map((m) => textOf(m.content)).join('\n');

  if (prompt.includes('<profile_interview>')) {
    if (/^(?:先到这|that's enough)/i.test(said)) {
      if (results.length > 0) return { text: 'Here is what I saved. Change it under About you.' };
      return callTool(profileTool('finishInterview'), {});
    }
    if (results.length > 0) return { text: `Got it. ${results[0]}` };
    for (const answer of PROFILE_ANSWERS) {
      const match = answer.pattern.exec(said);
      if (match)
        return callTool(profileTool('saveEntry'), {
          section: answer.section,
          text: answer.text(match),
        });
    }
    const next = /Still to ask: (\w+)/.exec(prompt)?.[1];
    return { text: next === 'name' ? 'Hi! What should I call you?' : `Next, your ${next}?` };
  }

  if (/^(?:还是这样|still holds)/i.test(said)) {
    if (results.length > 0) return { text: 'Good, noted that it still holds.' };
    const asked = request.messages
      .slice(0, lastUser)
      .filter((m) => m.role === 'assistant')
      .map((m) => textOf(m.content))
      .join('\n');
    const id = [...asked.matchAll(/\[([A-Z]+\d+|now|ideal|style)\]/g)].at(-1)?.[1];
    if (id) return callTool(profileTool('confirmEntries'), { ids: [id] });
  }
};

/** The script the fake model runs to make a three-slide deck with pptxgenjs. */
const DECK_SCRIPT = `const pptxgen = require('pptxgenjs');
const fs = require('fs');
fs.mkdirSync('biber-deck', { recursive: true });
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_16x9';
for (const title of ['Biber', '它能做什么', '下一步']) {
  pptx.addSlide().addText(title, { x: 0.7, y: 0.6, w: 8, h: 1, fontFace: 'Noto Sans CJK SC', fontSize: 32 });
}
pptx.writeFile({ fileName: 'biber-deck/deck.pptx' }).then(() => console.log('written'));`;

/** The script it runs to make a workbook with exceljs. */
const WORKBOOK_SCRIPT = `const ExcelJS = require('exceljs');
const fs = require('fs');
fs.mkdirSync('biber-report', { recursive: true });
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Report');
ws.addRow(['Month', 'Sales']);
ws.addRow(['Oct', 120]);
ws.addRow(['Nov', 150]);
ws.addRow(['Total', { formula: 'SUM(B2:B3)' }]);
ws.views = [{ state: 'frozen', ySplit: 1 }];
wb.xlsx.writeFile('biber-report/report.xlsx').then(() => console.log('written'));`;

/**
 * The document maker on the cloud computer:
 * - "make a three-slide deck" ("做一份三页的 PPT"): writes it with pptxgenjs, exports it, says so;
 * - "export an empty file" ("导出一个空文件"): exports an empty .pptx, which is refused, and says
 *   why without naming the file;
 * - "just say the report is ready" ("只说报告做好了"): claims report.xlsx without making it;
 * - a delivery check about report.xlsx: makes it with exceljs and exports it.
 */
const documentStep = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply | undefined => {
  if (!request.tools.includes(sandboxTool('executeCode'))) return;
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const said = textOf(request.messages[lastUser]?.content).trim();
  const results = request.messages
    .slice(lastUser + 1)
    .filter((m) => m.role === 'tool')
    .map((m) => textOf(m.content));

  const make = (script: string, path: string, done: string): Reply => {
    if (results.length === 0)
      return callTool(sandboxTool('executeCode'), { code: script, language: 'javascript' });
    if (results.length === 1) return callTool(sandboxTool('exportFile'), { path });
    return {
      text: /exported successfully/i.test(results[1]) ? done : `Export failed: ${results[1]}`,
    };
  };

  if (/three-slide deck|三页的 PPT/i.test(said)) {
    return make(DECK_SCRIPT, 'biber-deck/deck.pptx', '已交付 deck.pptx：三页，介绍 Biber。');
  }
  if (/export an empty file|导出一个空文件/i.test(said)) {
    if (results.length === 0) {
      return callTool(sandboxTool('runCommand'), {
        command: 'mkdir -p biber-empty && : > biber-empty/empty.pptx',
      });
    }
    if (results.length === 1)
      return callTool(sandboxTool('exportFile'), { path: 'biber-empty/empty.pptx' });
    return {
      text: /is empty \(0 bytes\)/.test(results[1])
        ? 'The export was refused: the file is empty.'
        : `Unexpected: ${results[1]}`,
    };
  }
  if (/just say the report is ready|只说报告做好了/i.test(said)) {
    return { text: '已生成 report.xlsx，请查收。' };
  }
  if (/^(?:（交付核对）|\(Delivery check\))/.test(said) && said.includes('report.xlsx')) {
    return make(WORKBOOK_SCRIPT, 'biber-report/report.xlsx', '补上了：已交付 report.xlsx。');
  }
};

/** A ref from a snapshot the model was given, by the element's name. */
const refNamed = (snapshot: string, name: RegExp) =>
  [...snapshot.matchAll(/^- (\S+) \w+ "([^"]*)"/gm)].find((match) => name.test(match[2]))?.[1];
const snapshotIdIn = (snapshot: string) => Number(/snapshotId (\d+)/.exec(snapshot)?.[1]);

/**
 * With the browser on Biber's cloud computer, on the page the message names:
 * - "sign in to the test shop at <url>": open it, list the saved logins, sign in with the first;
 *   "... with a code" then asks the user for the code the site wants and verifies it;
 * - "place the order at <url>": open it and click Place order, which goes through approval;
 * - "open the next page at <url>": click Next page, which does not;
 * - "press enter in the order note at <url>": press Enter in the note field, which is held.
 */
const computerStep = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply | undefined => {
  if (!request.tools.includes(computerTool('navigate'))) return;
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const said = textOf(request.messages[lastUser]?.content);
  const url = /https?:\/\/\S+/.exec(said)?.[0];
  if (!url) return;
  const results = request.messages
    .slice(lastUser + 1)
    .filter((m) => m.role === 'tool')
    .map((m) => textOf(m.content));
  const done = results.length;
  const last = results.at(-1) ?? '';

  if (done === 0) return callTool(computerTool('navigate'), { url });

  if (/^sign in to the test shop/i.test(said)) {
    if (done === 1) return callTool(computerTool('listLogins'), {});
    if (done === 2) {
      const login = /loginId (\S+) · site "([^"]*)" · account "([^"]*)"/.exec(results[1]);
      if (!login) return { text: 'There is no saved login for it.' };
      return callTool(computerTool('signIn'), {
        account: login[3],
        loginId: login[1],
        site: login[2],
      });
    }
    const asksForCode = /requestSecret/.test(results[2] ?? '');
    if (asksForCode && done === 3) return callTool(computerTool('snapshot'), {});
    if (asksForCode && done === 4) {
      return callTool(computerTool('requestSecret'), {
        label: 'the code texted to you',
        ref: refNamed(results[3], /code/i),
        snapshotId: snapshotIdIn(results[3]),
      });
    }
    if (asksForCode && done === 5) return callTool(computerTool('snapshot'), {});
    if (asksForCode && done === 6) {
      return callTool(computerTool('click'), {
        ref: refNamed(results[5], /verify/i),
        snapshotId: snapshotIdIn(results[5]),
      });
    }
    // Only a submitted form whose password field went away counts; any refusal does not
    if (!asksForCode && !/Submitted, and the password field is gone/.test(results[2] ?? '')) {
      return { text: 'I could not sign in there.' };
    }
    if (asksForCode && !/^"?Clicked/.test(last)) return { text: 'I could not sign in there.' };
    return { text: asksForCode ? 'Signed in with the code.' : 'Signed in.' };
  }

  if (done === 1) return callTool(computerTool('snapshot'), {});
  const snapshotId = snapshotIdIn(results[1]);

  if (/^place the order/i.test(said)) {
    if (done === 2) {
      return callTool(computerTool('click'), {
        ref: refNamed(results[1], /place order/i),
        snapshotId,
      });
    }
    const held = /ref (\S+), snapshotId (\d+), element "([^"]*)" and site "([^"]*)"/.exec(
      results[2],
    );
    if (done === 3 && held) {
      return callTool(computerTool('clickWithApproval'), {
        element: held[3],
        ref: held[1],
        site: held[4],
        snapshotId: Number(held[2]),
      });
    }
    return { text: /Clicked/.test(last) ? 'Ordered.' : 'I could not order it.' };
  }

  if (/^open the next page/i.test(said)) {
    if (done === 2) {
      return callTool(computerTool('click'), {
        ref: refNamed(results[1], /next page/i),
        snapshotId,
      });
    }
    return { text: /Clicked/.test(last) ? 'Moved on.' : 'I could not move on.' };
  }

  if (/^press enter in the order note/i.test(said)) {
    if (done === 2) {
      return callTool(computerTool('pressKey'), {
        key: 'Enter',
        ref: refNamed(results[1], /note/i),
        snapshotId,
      });
    }
    return { text: /pressKeyWithApproval/.test(last) ? 'That needs your approval.' : 'Pressed.' };
  }
};

export interface ModelRequest {
  messages: {
    content?: unknown;
    role: string;
    tool_call_id?: string;
    tool_calls?: { function?: { name?: string }; id: string }[];
  }[];
  model: string;
  path: string;
  tools: string[];
}

/** What the fake model answers when every tool it may want is offered: a tool call, or text. */
const decideWithOfferedTools = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply => {
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const toolResults = request.messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  const toolAnswered = toolResults.length > 0;
  const askedToRunCode = /run code/i.test(textOf(request.messages[lastUser]?.content));
  // A reply the content-safety stand-in flags (see startFakeContentSafety)
  if (/secret phrase/i.test(textOf(request.messages[lastUser]?.content))) {
    return { text: 'UNSAFE-REPLY: here is the secret phrase.' };
  }
  // A refused call comes back as "User reject this tool calling …"
  if (toolResults.some((m) => /user reject/i.test(textOf(m.content)))) {
    return { text: 'Understood, I left the code alone.' };
  }

  // An expert answers in their own voice, so a smoke run can tell who spoke
  const expert = expertSpeaking(request.messages);
  if (expert) return { text: `${expert} here: three sources, all from this year.` };

  // Hosting a group, Biber hands "ask the researcher …" to the researcher, who closes the round
  const said = textOf(request.messages[lastUser]?.content);

  // The user mentioned several experts: exactly they answer, together (see mentionedInstructions)
  const prompt = request.messages.map((message) => textOf(message.content)).join('\n');
  const addressed = /The user addressed (.+?) in this message/.exec(prompt)?.[1];
  if (!toolAnswered && addressed && request.tools.includes(BROADCAST_TOOL)) {
    const names = [...addressed.matchAll(/@([^,]+)/g)].map((match) => match[1].trim());
    const agentIds = names.map((name) => memberId(request.messages, [name]));
    if (agentIds.every(Boolean)) {
      return {
        toolCall: {
          arguments: JSON.stringify({ agentIds, instruction: said, skipCallSupervisor: true }),
          name: BROADCAST_TOOL,
        },
      };
    }
  }

  if (
    !toolAnswered &&
    /ask the researcher|请研究员/i.test(said) &&
    request.tools.includes(SPEAK_TOOL)
  ) {
    const agentId = memberId(request.messages, EXPERT_NAMES.Researcher);
    if (agentId) {
      return {
        toolCall: {
          arguments: JSON.stringify({ agentId, instruction: said, skipCallSupervisor: true }),
          name: SPEAK_TOOL,
        },
      };
    }
  }

  const personal =
    mailStep(request) ??
    calendarStep(request) ??
    computerStep(request) ??
    profileStep(request) ??
    documentStep(request);
  if (personal) return personal;

  const reminder = reminderFor(textOf(request.messages[lastUser]?.content));
  if (reminder && request.tools.includes(REMIND_TOOL)) {
    if (toolAnswered) return { text: 'Noted, I will bring it up.' };
    return { toolCall: { arguments: JSON.stringify(reminder), name: REMIND_TOOL } };
  }

  if (!toolAnswered && askedToRunCode && request.tools.includes(CODE_TOOL)) {
    return {
      toolCall: {
        arguments: JSON.stringify({
          code: 'print(1 + 1)',
          description: 'Add one and one',
          language: 'python',
        }),
        name: CODE_TOOL,
      },
    };
  }
  return { text: toolAnswered ? 'The code ran.' : 'Hello from the fake model.' };
};

export const ACTIVATE_TOOL = 'lobe-activator____activateTools';

const pluginOf = (tool: string) => tool.split('____')[0];

/** The plugins the context lists as ready to activate (`<available_tools>`, in a user turn). */
const activatablePlugins = (messages: ModelRequest['messages']) =>
  new Set(
    messages
      .flatMap((message) => [...textOf(message.content).matchAll(/<tool identifier="([^"]+)"/g)])
      .map((match) => match[1]),
  );

/** The conversation without the turns that only activated tools, and their results. */
const withoutActivations = (messages: ModelRequest['messages']) => {
  const activationIds = new Set(
    messages.flatMap((message) =>
      (message.tool_calls ?? [])
        .filter((call) => call.function?.name === ACTIVATE_TOOL)
        .map((call) => call.id),
    ),
  );

  return messages.filter(
    (message) =>
      !(message.role === 'tool' && activationIds.has(message.tool_call_id ?? '')) &&
      !(
        message.tool_calls?.length &&
        message.tool_calls.every((call) => call.function?.name === ACTIVATE_TOOL)
      ),
  );
};

/**
 * What the fake model answers: a tool call, or text. Upstream loads most tools on demand: the
 * request offers the activator, and the prompt lists the other plugins in `<available_tools>`.
 * The fake decides as if a listed plugin's tools were offered, and when it picks one that is not,
 * activates that plugin first, as a model does. The activation turns are left out of what it
 * decides on, so the step after one carries on where it was.
 */
export const decideReply = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply => {
  const offered = request.tools;
  const listed = offered.includes(ACTIVATE_TOOL)
    ? activatablePlugins(request.messages)
    : new Set<string>();
  const tools = Object.assign([...offered], {
    includes: (tool: string) => offered.includes(tool) || listed.has(pluginOf(tool)),
  });

  const reply = decideWithOfferedTools({ messages: withoutActivations(request.messages), tools });
  if (!('toolCall' in reply) || offered.includes(reply.toolCall.name)) return reply;

  return callTool(ACTIVATE_TOOL, {
    identifiers: [pluginOf(reply.toolCall.name)],
    reason: 'Needed for this request',
  });
};

/**
 * The JSON the fake model gives for structured output the server asks for by schema name, whether
 * as a forced tool call (DeepSeek) or a JSON schema (OpenAI): a routine's brief, and a message
 * Biber sends on its own about the first item it is offered.
 */
export const decideStructuredReply = (
  name: string,
  messages: ModelRequest['messages'],
): Record<string, unknown> | undefined => {
  const prompt = messages.map((message) => textOf(message.content)).join('\n');
  switch (name) {
    case 'task_topic_brief': {
      return { summary: 'The interview at ten comes first.', title: 'Three things today' };
    }
    case 'task_topic_brief_judge': {
      return { emit: true, reason: 'smoke' };
    }
    case 'proactive_message': {
      const id = /- id: (\S+)/.exec(prompt)?.[1];
      const about = /about: (.+)/.exec(prompt)?.[1];
      return id
        ? { content: `Heads up: ${about}.`, reason: '', skip: false, thoughtId: id }
        : { content: '', reason: 'nothing to say', skip: true, thoughtId: '' };
    }
  }
};

const sse = (res: ServerResponse, chunks: object[]) => {
  res.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
};

const completionChunks = (model: string, reply: ReturnType<typeof decideReply>) => {
  const base = {
    created: Math.floor(Date.now() / 1000),
    id: `chatcmpl-${Date.now()}`,
    model,
    object: 'chat.completion.chunk',
  };
  if ('toolCall' in reply) {
    return [
      {
        ...base,
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  function: { arguments: reply.toolCall.arguments, name: reply.toolCall.name },
                  id: `call_${Date.now()}`,
                  index: 0,
                  type: 'function',
                },
              ],
            },
            finish_reason: null,
            index: 0,
          },
        ],
      },
      { ...base, choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }] },
      {
        ...base,
        choices: [],
        usage: { completion_tokens: 12, prompt_tokens: 40, total_tokens: 52 },
      },
    ];
  }
  return [
    {
      ...base,
      choices: [
        { delta: { content: reply.text, role: 'assistant' }, finish_reason: null, index: 0 },
      ],
    },
    { ...base, choices: [{ delta: {}, finish_reason: 'stop', index: 0 }] },
    { ...base, choices: [], usage: { completion_tokens: 5, prompt_tokens: 40, total_tokens: 45 } },
  ];
};

export const startFakeModel = async (port: number) => {
  const requests: ModelRequest[] = [];
  const server = createServer(async (req, res) => {
    const path = req.url ?? '';
    if (req.method === 'GET' && path.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini', object: 'model' }], object: 'list' }));
      return;
    }
    const body = await readJson(req).catch(() => ({}));
    const request: ModelRequest = {
      messages: body.messages ?? [],
      model: body.model ?? '',
      path,
      tools: (body.tools ?? []).map((tool: any) => tool?.function?.name ?? tool?.name),
    };
    requests.push(request);

    if (path.endsWith('/embeddings')) {
      // Enough for memories to be stored: every text gets the same small vector
      const inputs: unknown[] = Array.isArray(body.input) ? body.input : [body.input];
      const embedding = Array.from({ length: body.dimensions ?? 1024 }, () => 0.01);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: inputs.map((_, index) => ({ embedding, index, object: 'embedding' })),
          model: body.model,
          object: 'list',
          usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
        }),
      );
      return;
    }
    if (path.endsWith('/responses')) {
      // OpenAI's structured output goes through the Responses API
      const input: ModelRequest['messages'] = body.input ?? [];
      const schemaName: string | undefined = body.text?.format?.name;
      const structured = schemaName && decideStructuredReply(schemaName, input);
      const text = structured ? JSON.stringify(structured) : 'Hello from the fake model.';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          created_at: Math.floor(Date.now() / 1000),
          id: `resp_${Date.now()}`,
          model: body.model,
          object: 'response',
          output: [
            {
              content: [{ annotations: [], text, type: 'output_text' }],
              id: `msg_${Date.now()}`,
              role: 'assistant',
              status: 'completed',
              type: 'message',
            },
          ],
          output_text: text,
          status: 'completed',
          usage: { input_tokens: 40, output_tokens: 5, total_tokens: 45 },
        }),
      );
      return;
    }
    if (!path.endsWith('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `fake model does not serve ${path}` } }));
      return;
    }
    const schemaName: string | undefined =
      body.tool_choice?.function?.name ?? body.response_format?.json_schema?.name;
    const structured = schemaName && decideStructuredReply(schemaName, request.messages);
    const reply: ReturnType<typeof decideReply> = structured
      ? body.tool_choice
        ? { toolCall: { arguments: JSON.stringify(structured), name: schemaName! } }
        : { text: JSON.stringify(structured) }
      : decideReply(request);
    // Like the real API, a request that does not ask for a stream gets one JSON answer
    if (body.stream !== true) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'toolCall' in reply ? 'tool_calls' : 'stop',
              index: 0,
              message:
                'toolCall' in reply
                  ? {
                      content: null,
                      role: 'assistant',
                      tool_calls: [{ function: reply.toolCall, id: 'call_1', type: 'function' }],
                    }
                  : { content: reply.text, role: 'assistant' },
            },
          ],
          id: 'chatcmpl-1',
          model: request.model,
          object: 'chat.completion',
          usage: { completion_tokens: 5, prompt_tokens: 40, total_tokens: 45 },
        }),
      );
      return;
    }
    sse(res, completionChunks(request.model, reply));
  });
  await listen(server, port);
  return { close: () => server.close(), requests };
};

/**
 * Object storage for files the server stores (exports from the cloud computer): path-style
 * `PUT`, `HEAD` and `GET` on `/<bucket>/<key>`, signatures not checked. Point the server at it
 * with S3_ENDPOINT=http://127.0.0.1:<port> and S3_ENABLE_PATH_STYLE=1.
 */
