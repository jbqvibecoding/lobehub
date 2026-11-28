/**
 * Stand-ins for the services a Biber server calls out to, so a smoke run needs no accounts:
 *
 * - an OpenAI-compatible model that, when a request offers the cloud computer's code tool and the
 *   user asked to run code, calls that tool (likewise Biber's reminders tool, see `reminderFor`);
 *   once the tool has answered, it replies in text. Running as an expert it answers "Researcher
 *   here: …"; hosting a group, Biber hands "ask the researcher …" to the researcher with `speak`;
 *   with the user's mailbox and calendar, it reads the latest mail, replies to it, finds free time
 *   and creates an event (see `mailStep` and `calendarStep`);
 *   on its cloud computer, it opens the page a message names and signs in, orders or presses Enter
 *   there (see `computerStep`); with its profile tool, it runs the "About you" interview and
 *   answers profile checks (see `profileStep`); as the document maker, it writes and exports files
 *   on the cloud computer (see `documentStep`);
 *   when the user mentions several experts in a group, Biber broadcasts to exactly them;
 * - an Anthropic-format model behind the coding gateway (`startFakeAnthropic`), and GitHub as the
 *   Biber GitHub App sees it (`startFakeGithub`);
 * - Expo's push service, recording every notification it is asked to send;
 * - object storage for exported files (`startFakeS3`);
 * - Feishu's open platform for a user's calendar (`startFakeFeishuApi`).
 *
 * Point the server at them with OPENAI_PROXY_URL=http://127.0.0.1:<model>/v1 and
 * EXPO_BASE_URL=http://127.0.0.1:<push>.
 */
import { execFileSync } from 'node:child_process';
import { createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttp2Server } from 'node:http2';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

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
  messages: { content?: unknown; role: string }[];
  model: string;
  path: string;
  tools: string[];
}

export interface PushRequest {
  body: string;
  /** The notification category that gives it buttons, when it has any */
  categoryId?: string;
  data?: Record<string, string>;
  title: string;
  to: string;
}

const readJson = async (req: IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
};

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => part?.text ?? '').join('')
      : '';

/** What the fake model answers: a tool call, or text. */
export const decideReply = (request: Pick<ModelRequest, 'messages' | 'tools'>): Reply => {
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

const listen = (server: Server, port: number) =>
  new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));

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
export const startFakeS3 = async (port: number) => {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const server = createServer(async (req, res) => {
    const key = decodeURIComponent(new URL(req.url ?? '/', 'http://s3').pathname);
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      objects.set(key, {
        body: Buffer.concat(chunks),
        type: String(req.headers['content-type'] ?? 'application/octet-stream'),
      });
      res.writeHead(200, { ETag: '"smoke"' });
      res.end();
      return;
    }
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      res.end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    res.writeHead(200, {
      'Content-Length': String(object.body.length),
      'Content-Type': object.type,
      'ETag': '"smoke"',
      'Last-Modified': new Date().toUTCString(),
    });
    res.end(req.method === 'HEAD' ? undefined : object.body);
  });
  await listen(server, port);
  return { close: () => server.close(), objects };
};

export const startFakeExpoPush = async (port: number) => {
  const sent: PushRequest[] = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url?.includes('/push/send')) {
      const messages: PushRequest[] = Array.isArray(body) ? body : [body];
      sent.push(...messages);
      res.end(
        JSON.stringify({
          data: messages.map((_, i) => ({ id: `ticket-${Date.now()}-${i}`, status: 'ok' })),
        }),
      );
      return;
    }
    res.end(JSON.stringify({ data: {} }));
  });
  await listen(server, port);
  return { close: () => server.close(), sent };
};

/** Alibaba Cloud SMS, keeping the verification code of every message it is asked to send. */
export const startFakeAliyunSms = async (port: number) => {
  const codes = new Map<string, string>();
  const server = createServer((req, res) => {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const phone = query.get('PhoneNumbers') ?? '';
    const code = JSON.parse(query.get('TemplateParam') ?? '{}').code;
    if (phone && code) codes.set(phone, code);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ BizId: `biz-${Date.now()}`, Code: 'OK', Message: 'OK' }));
  });
  await listen(server, port);
  return { close: () => server.close(), codes };
};

/** WeChat's Official Account API, keeping every customer-service message the bot sends. */
export interface ContentCheck {
  content: string;
  service: string;
}

/**
 * Alibaba Cloud Content Moderation's Text Moderation Plus. It flags what users ask when it holds
 * `BLOCKME`, and model replies when they hold `UNSAFE-REPLY`; everything else passes. Keeps every
 * check it was asked for.
 */
export const startFakeContentSafety = async (port: number) => {
  const checks: ContentCheck[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const service = url.searchParams.get('Service') ?? '';
    const { content = '' } = JSON.parse(url.searchParams.get('ServiceParameters') ?? '{}');
    checks.push({ content, service });
    const flagged =
      (service === 'llm_query_moderation' && content.includes('BLOCKME')) ||
      (service === 'llm_response_moderation' && content.includes('UNSAFE-REPLY'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        Code: 200,
        Data: {
          Result: [{ Label: flagged ? 'political_content' : 'nonLabel' }],
          RiskLevel: flagged ? 'high' : 'none',
        },
        RequestId: `req-${checks.length}`,
      }),
    );
  });
  await listen(server, port);
  return { checks, close: () => server.close() };
};

export const startFakeWechatApi = async (port: number) => {
  const sent: { content: string; to: string }[] = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url?.startsWith('/cgi-bin/stable_token')) {
      res.end(JSON.stringify({ access_token: `smoke-token-${Date.now()}`, expires_in: 7200 }));
      return;
    }
    if (req.url?.startsWith('/cgi-bin/message/custom/send') && body.msgtype === 'text') {
      sent.push({ content: body.text?.content ?? '', to: body.touser });
    }
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
  });
  await listen(server, port);
  return { close: () => server.close(), sent };
};

/** A message's text, whether sent as plain text or as one of Telegram's rich messages */
const messageText = (body: any): string =>
  String(body.text ?? body.rich_message?.markdown ?? body.caption ?? '');

export interface TelegramCall {
  body: any;
  method: string;
  result?: any;
}

/**
 * Telegram's Bot API. Every method answers `ok`; sent messages get increasing ids. Keeps every
 * call, so a run can find the messages and buttons the bot sent.
 */
export const startFakeTelegramApi = async (
  port: number,
  { botUsername = 'biber_smoke_bot', webhookUrl = 'https://biber.test/telegram' } = {},
) => {
  const calls: TelegramCall[] = [];
  let nextMessageId = 1000;
  const server = createServer(async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    const method = (req.url ?? '').split('?')[0].split('/').pop() ?? '';
    const call: TelegramCall = { body, method };
    calls.push(call);

    let result: unknown = true;
    if (method === 'getWebhookInfo') {
      // A registered webhook, as in production; without one the bot falls back to polling
      result = { has_custom_certificate: false, pending_update_count: 0, url: webhookUrl };
    } else if (method === 'getUpdates') {
      result = [];
    } else if (method === 'getMe') {
      result = { first_name: 'Biber', id: 7_000_000, is_bot: true, username: botUsername };
    } else if (method === 'sendMessage' || method.startsWith('send')) {
      result = {
        chat: { id: Number(body.chat_id), type: 'private' },
        date: Math.floor(Date.now() / 1000),
        message_id: nextMessageId++,
        text: messageText(body),
      };
    } else if (method.startsWith('edit')) {
      result = {
        chat: { id: Number(body.chat_id), type: 'private' },
        date: Math.floor(Date.now() / 1000),
        message_id: body.message_id,
        text: messageText(body),
      };
    }
    call.result = result;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  });
  await listen(server, port);

  /** The texts sent or edited into a chat, oldest first; drafts (streaming previews) are left out */
  const textsTo = (chatId: number | string) =>
    calls
      .filter(
        (call) =>
          /^(?:send|edit)\w*(?:Message|Text)$/.test(call.method) &&
          String(call.body.chat_id) === String(chatId),
      )
      .map((call) => ({
        buttons: (call.body.reply_markup?.inline_keyboard ?? []).flat() as {
          callback_data?: string;
          text: string;
          url?: string;
        }[],
        messageId: (call.result?.message_id ?? call.body.message_id) as number | undefined,
        text: messageText(call.body),
      }));

  return { calls, close: () => server.close(), textsTo };
};

export interface LinqSent {
  chatId?: string;
  text: string;
  to?: string[];
}

/** Who Linq can start a chat with: a phone number in E.164 form or an email address */
const isLinqRecipient = (handle: unknown) =>
  typeof handle === 'string' &&
  (/^\+[1-9]\d{6,14}$/.test(handle) || /^[^@\s]+@[^@\s]+$/.test(handle));

/**
 * Linq's partner API (`/api/partner/v3/...`), keeping every message the line sends. Like Linq, it
 * refuses to start a chat with anything other than a phone number or email address.
 */
export const startFakeLinqApi = async (port: number) => {
  const sent: LinqSent[] = [];
  let nextId = 1;
  const server = createServer(async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    const path = (req.url ?? '').split('?')[0].replace(/^\/api\/partner/, '');
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const text = (body.message?.parts ?? [])
      .map((part: any) => (typeof part.value === 'string' ? part.value : ''))
      .join('');
    const sentMessage = (chatId: string) => ({
      chat_id: chatId,
      message: { id: `linq-msg-${nextId++}`, parts: body.message?.parts ?? [] },
    });

    // A new chat, started by its first message
    if (req.method === 'POST' && (path === '/v3/chats' || path === '/v3/messages')) {
      const to: unknown[] = body.to ?? [];
      if (to.length === 0 || !to.every(isLinqRecipient)) {
        json(400, { error: { message: `invalid recipient: ${JSON.stringify(to)}` } });
        return;
      }
      sent.push({ text, to: to as string[] });
      json(200, sentMessage(`chat-${to[0]}`));
      return;
    }
    const inChat = path.match(/^\/v3\/chats\/([^/]+)\/messages$/);
    if (req.method === 'POST' && inChat) {
      sent.push({ chatId: decodeURIComponent(inChat[1]), text });
      json(200, sentMessage(decodeURIComponent(inChat[1])));
      return;
    }
    const chat = path.match(/^\/v3\/chats\/([^/]+)$/);
    if (req.method === 'GET' && chat) {
      json(200, { id: decodeURIComponent(chat[1]), is_group: false });
      return;
    }
    // Typing, read receipts, reactions, edits: accepted and not recorded
    json(200, {});
  });
  await listen(server, port);
  return { close: () => server.close(), sent };
};

export interface LarkSent {
  /** An interactive message's card, parsed */
  card?: any;
  /** `text`, `interactive`, …; edits keep the type they were sent with */
  msgType?: string;
  /** The tenant whose token the request carried */
  tenant?: string;
  text: string;
  /** chat_id or open_id the message went to, or the message it replies to or edits */
  to: string;
}

/**
 * Lark's open platform (`/open-apis/...`) for a store app installed by several tenants. Each
 * tenant gets its own token (`t-<tenant key>`), so a run can check which tenant a message was
 * sent as. Keeps every message sent, replied or edited.
 */
export const startFakeLarkApi = async (port: number) => {
  const sent: LarkSent[] = [];
  let nextId = 1;
  const server = createServer(async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/^\/open-apis/, '');
    const json = (value: Record<string, unknown>) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, msg: 'ok', ...value }));
    };

    if (path === '/auth/v3/app_access_token') {
      json({ app_access_token: `a-${body.app_id}`, expire: 7200 });
      return;
    }
    if (path === '/auth/v3/tenant_access_token') {
      json({ expire: 7200, tenant_access_token: `t-${body.tenant_key}` });
      return;
    }
    if (path === '/tenant/v2/tenant/query') {
      json({ data: { tenant: { name: 'Smoke Corp' } } });
      return;
    }
    if (path === '/bot/v3/info') {
      json({ bot: { app_name: 'Biber', open_id: 'ou_biber_bot' } });
      return;
    }

    const tenant = req.headers.authorization?.replace(/^Bearer t-/, '');
    const messageText = () => {
      try {
        const content = JSON.parse(body.content ?? '{}');
        return String(content.text ?? JSON.stringify(content));
      } catch {
        return String(body.content ?? '');
      }
    };
    const sentMessage = () => ({
      data: { chat_id: body.receive_id, message_id: `om_${nextId++}` },
    });

    if (req.method === 'POST' && path === '/im/v1/messages') {
      const card = body.msg_type === 'interactive' ? JSON.parse(body.content) : undefined;
      sent.push({ card, msgType: body.msg_type, tenant, text: messageText(), to: body.receive_id });
      json(sentMessage());
      return;
    }
    const onMessage = path.match(/^\/im\/v1\/messages\/([^/]+)(\/reply)?$/);
    if (onMessage && (req.method === 'PUT' || req.method === 'PATCH' || onMessage[2])) {
      sent.push({ tenant, text: messageText(), to: onMessage[1] });
      json(sentMessage());
      return;
    }
    if (path.endsWith('/reactions') && req.method === 'POST') {
      json({ data: { reaction_id: `r_${nextId++}` } });
      return;
    }
    json({ data: {} });
  });
  await listen(server, port);
  return { close: () => server.close(), sent };
};

/** An event the fake Feishu calendar was asked to create. */
export interface FeishuCreated {
  body: any;
  calendarId: string;
}

/**
 * Feishu's open platform (`/open-apis/...`) for one user's calendar: the authorization code
 * `smoke-code` gives the user token `u-smoke`, the user is "Ada Feishu", and the primary calendar
 * already has a meeting tomorrow from 14:00 to 15:00, China time. Calls without the user token
 * answer as Feishu does for an invalid token. Keeps the events it is asked to create.
 */
export const startFakeFeishuApi = async (port: number) => {
  const created: FeishuCreated[] = [];
  const tokenRequests: Record<string, string>[] = [];
  const at = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));
  const busy = {
    end_time: { timestamp: at(tomorrowInChina(15)), timezone: 'Asia/Shanghai' },
    event_id: 'evt_busy',
    start_time: { timestamp: at(tomorrowInChina(14)), timezone: 'Asia/Shanghai' },
    status: 'confirmed',
    summary: 'Design review',
  };

  const server = createServer(async (req, res) => {
    const body = await readJson(req).catch(() => ({}));
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/^\/open-apis/, '');
    const json = (value: Record<string, unknown>, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };

    if (req.method === 'POST' && path === '/authen/v2/oauth/token') {
      tokenRequests.push(body);
      const granted =
        (body.grant_type === 'authorization_code' && body.code === 'smoke-code') ||
        (body.grant_type === 'refresh_token' && body.refresh_token === 'r-smoke');
      if (!granted) {
        json({ code: 20_003, error: 'invalid_grant', error_description: 'bad code' }, 400);
        return;
      }
      json({
        access_token: 'u-smoke',
        code: 0,
        expires_in: 7200,
        refresh_token: 'r-smoke',
        refresh_token_expires_in: 2_592_000,
      });
      return;
    }

    if (req.headers.authorization !== 'Bearer u-smoke') {
      json({ code: 99_991_668, msg: 'Invalid access token for authorization' }, 400);
      return;
    }
    if (req.method === 'GET' && path === '/authen/v1/user_info') {
      json({ code: 0, data: { name: 'Ada Feishu' } });
      return;
    }
    if (req.method === 'POST' && path === '/calendar/v4/calendars/primary') {
      json({ code: 0, data: { calendars: [{ calendar: { calendar_id: 'cal_ada' } }] } });
      return;
    }
    const events = /^\/calendar\/v4\/calendars\/([^/]+)\/events(?:\/(instance_view|[^/]+))?/.exec(
      path,
    );
    if (events && req.method === 'GET' && events[2] === 'instance_view') {
      const from = Number(url.searchParams.get('start_time'));
      const to = Number(url.searchParams.get('end_time'));
      const items = [
        busy,
        ...created.map(({ body }, index) => ({ ...body, event_id: `evt_${index}` })),
      ]
        .filter((event) => Number(event.end_time.timestamp) > from)
        .filter((event) => Number(event.start_time.timestamp) < to);
      json({ code: 0, data: { items } });
      return;
    }
    if (events && req.method === 'POST' && !events[2]) {
      created.push({ body, calendarId: decodeURIComponent(events[1]) });
      json({ code: 0, data: { event: { ...body, event_id: `evt_${created.length - 1}` } } });
      return;
    }
    json({ code: 0, data: {} });
  });
  await listen(server, port);
  return { close: () => server.close(), created, tokenRequests };
};

/**
 * The OpenBot supervisor for one real agent-computer running on this machine: every computer it
 * is asked for is that one, already running.
 */
export const startFakeSupervisor = async (
  port: number,
  { computerUrl, token }: { computerUrl: string; token: string },
) => {
  const server = createServer((req, res) => {
    res.writeHead(req.headers.authorization === `Bearer ${token}` ? 200 : 401, {
      'Content-Type': 'application/json',
    });
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.end(JSON.stringify({ error: 'Unauthorized.' }));
      return;
    }
    const id = /^\/computers\/([\w-]+)/.exec(req.url ?? '')?.[1];
    res.end(JSON.stringify({ botId: id, status: 'running', url: computerUrl }));
  });
  await listen(server, port);
  return { close: () => server.close() };
};

/** What the test shop received: logins, codes and orders, as the browser sent them. */
export interface ShopReceived {
  codes: string[];
  logins: { password: string; username: string }[];
  orders: string[];
}

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

/**
 * A small shop for the cloud computer's browser: a sign-in page, one that then asks for a texted
 * code, and a checkout page with Next page and Place order buttons and an order note. It keeps
 * what it is sent, so a smoke run can check that the right values arrived.
 */
export const startTestShop = async (
  port: number,
  account: { code: string; password: string; username: string },
) => {
  const received: ShopReceived = { codes: [], logins: [], orders: [] };
  const form = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  };
  const loginForm = (action: string) =>
    `<form method="post" action="${action}"><label>Email <input name="email" type="email" autocomplete="username"></label><label>Password <input name="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>`;

  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const send = (html: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    };

    if (req.method === 'GET' && (path === '/login' || path === '/login-code')) {
      send(page('Sign in to Test Shop', loginForm(path)));
      return;
    }
    if (req.method === 'POST' && (path === '/login' || path === '/login-code')) {
      const body = await form(req);
      const login = { password: body.get('password') ?? '', username: body.get('email') ?? '' };
      received.logins.push(login);
      const right = login.username === account.username && login.password === account.password;
      if (!right) {
        send(page('Sign in to Test Shop', `<p>Wrong email or password.</p>${loginForm(path)}`));
      } else if (path === '/login-code') {
        send(
          page(
            'Enter your code',
            '<form method="post" action="/verify"><label>Verification code <input name="code" autocomplete="one-time-code" inputmode="numeric"></label><button type="submit">Verify</button></form>',
          ),
        );
      } else {
        send(page('Welcome back, Ada', '<p>You are signed in.</p>'));
      }
      return;
    }
    if (req.method === 'POST' && path === '/verify') {
      const code = (await form(req)).get('code') ?? '';
      received.codes.push(code);
      send(page(code === account.code ? 'Welcome back, Ada' : 'Wrong code', '<p>Done.</p>'));
      return;
    }
    if (req.method === 'GET' && path === '/checkout') {
      send(
        page(
          'Checkout',
          '<p>One blue mug, ¥39.</p><a href="/checkout?page=2" role="button">Next page</a><form method="post" action="/order"><label>Order note <input name="note" type="text"></label><button type="submit">Place order</button></form>',
        ),
      );
      return;
    }
    if (req.method === 'POST' && path === '/order') {
      received.orders.push((await form(req)).get('note') ?? '');
      send(page('Order placed', '<p>Thank you.</p>'));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  await listen(server, port);
  return { close: () => server.close(), received };
};

/** A plain PNG of the given size: a light page with a dark top bar and a box, like a login page. */
const fakePagePicture = (width: number, height: number) => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer) => {
    let c = 0xff_ff_ff_ff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xff_ff_ff_ff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const inBar = y < 64;
      const inBox = x > width / 2 - 200 && x < width / 2 + 200 && y > 220 && y < 520;
      const [r, g, b] = inBar ? [31, 41, 55] : inBox ? [255, 255, 255] : [243, 244, 246];
      row.set([r, g, b], 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
};

/**
 * An OpenBot supervisor and the computers it runs, answering as apps/computer does: the supervisor
 * reports and starts computers by bot id; each computer has a browser whose wheel the Bot or a person
 * holds, refuses a person's input until they hold it, and answers only its own bot with its own token
 * (HMAC of its id under the computer secret, as the supervisor hands it out).
 *
 * Point the server at it with SANDBOX_PROVIDER=openbot, OPENBOT_SUPERVISOR_URL=http://127.0.0.1:<supervisor>
 * and OPENBOT_SUPERVISOR_TOKEN / OPENBOT_COMPUTER_TOKEN set to the secrets passed here.
 */
export const startFakeOpenBot = async ({
  computerPort,
  computerSecret,
  supervisorPort,
  supervisorToken,
}: {
  computerPort: number;
  computerSecret: string;
  supervisorPort: number;
  supervisorToken: string;
}) => {
  const computerUrl = `http://127.0.0.1:${computerPort}`;
  const running = new Set<string>();
  const ensured: string[] = [];
  const control = new Map<
    string,
    {
      holder: 'bot' | 'human';
      request?: { id: string; reason: string; source: string; status: string };
    }
  >();
  const humanInputs: { action: string; body: unknown; botId: string }[] = [];
  /** The network policy the server pushed to each computer. */
  const policies = new Map<string, any>();
  const picture = fakePagePicture(1280, 800);
  let nextRequest = 1;

  const stateOf = (botId: string) => {
    const state = control.get(botId) ?? { holder: 'bot' as const };
    control.set(botId, state);
    return {
      holder: state.holder,
      reason: state.request?.status === 'waiting' ? state.request.reason : undefined,
      request: state.request,
      requested: state.request?.status === 'waiting',
      resumeSnapshotRequired: false,
      since: new Date().toISOString(),
      transitioning: false,
    };
  };

  const supervisor = createServer(async (req, res) => {
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${supervisorToken}`) {
      json({ error: 'Unauthorized.' }, 401);
      return;
    }
    const match = (req.url ?? '').match(/^\/computers\/([\w-]+)(\/ensure)?$/);
    if (!match) {
      json({ error: 'Not found' }, 404);
      return;
    }
    const botId = match[1];
    if (match[2] && req.method === 'POST') {
      running.add(botId);
      ensured.push(botId);
    }
    json(
      running.has(botId)
        ? { botId, status: 'running', url: computerUrl }
        : { botId, status: 'absent' },
    );
  });

  const computer = createServer(async (req, res) => {
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const botId = String(req.headers['x-openbot-bot-id'] ?? '');
    const token = createHmac('sha256', computerSecret).update(`computer:${botId}`).digest('hex');
    if (!running.has(botId) || req.headers.authorization !== `Bearer ${token}`) {
      json({ error: 'Not authorised.' }, 403);
      return;
    }
    const path = new URL(req.url ?? '/', computerUrl).pathname;
    const body = req.method === 'POST' ? await readJson(req).catch(() => ({})) : {};
    const state = control.get(botId) ?? { holder: 'bot' as const };
    control.set(botId, state);

    if (path === '/egress-policy' && req.method === 'PUT') {
      policies.set(botId, body.policy);
      return json({ botId, policy: body.policy });
    }
    if (path === '/control' && req.method === 'GET') return json(stateOf(botId));
    if (path === '/screenshot') {
      return json({
        base64: picture,
        capturedAt: new Date().toISOString(),
        height: 800,
        url: 'https://example.com/login',
        width: 1280,
      });
    }
    if (path === '/control/request') {
      if (state.holder === 'bot' && state.request?.status !== 'waiting') {
        state.request = {
          id: `req-${nextRequest++}`,
          reason: body.reason ?? 'The assistant needs a person to continue.',
          source: body.source ?? 'model',
          status: 'waiting',
        };
      }
      return json(stateOf(botId));
    }
    if (path === '/control/take' || path === '/control/release') {
      if (body.requestId !== state.request?.id) {
        return json({ error: 'That request is no longer the current handoff.' }, 409);
      }
      if (path === '/control/take') {
        state.holder = 'human';
        state.request!.status = 'taken';
      } else {
        state.holder = 'bot';
        state.request!.status = 'completed';
      }
      return json(stateOf(botId));
    }
    if (path.startsWith('/human/')) {
      if (state.holder !== 'human') return json({ error: 'Take control first.' }, 409);
      humanInputs.push({ action: path.slice('/human/'.length), body, botId });
      return json({ action: path, url: 'https://example.com/login' });
    }
    json({ error: 'Not found' }, 404);
  });

  await Promise.all([listen(supervisor, supervisorPort), listen(computer, computerPort)]);
  return {
    /** The Bot asking for a person, as the computer tools do when they are stuck. */
    askForHelp: (botId: string, reason: string) => {
      control.set(botId, {
        holder: 'bot',
        request: { id: `req-${nextRequest++}`, reason, source: 'model', status: 'waiting' },
      });
    },
    close: () => {
      supervisor.close();
      computer.close();
    },
    control,
    ensured,
    humanInputs,
    policies,
    running,
  };
};

/**
 * Apple's push service (APNs), over HTTP/2 without TLS: records each notification with whether its
 * provider token is an ES256 JWT signed by the key whose public half is given, and answers 410
 * Unregistered for device tokens that start with `gone`.
 *
 * Point the server at it with APNS_ENDPOINT=http://127.0.0.1:<port>.
 */
export const startFakeApns = async (port: number, publicKeyPem: string) => {
  const sent: {
    headers: Record<string, string>;
    payload: any;
    providerToken: { claims: any; header: any; signed: boolean };
    token: string;
  }[] = [];
  const publicKey = createPublicKey(publicKeyPem);
  const server = createHttp2Server((request, response) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => {
      const headers = request.headers as Record<string, string>;
      const [header = '', claims = '', signature = ''] = (headers.authorization ?? '')
        .replace(/^bearer /, '')
        .split('.');
      const decode = (part: string) => {
        try {
          return JSON.parse(Buffer.from(part, 'base64url').toString());
        } catch {
          return undefined;
        }
      };
      const token = (headers[':path'] ?? '').split('/').pop() ?? '';
      sent.push({
        headers,
        payload: JSON.parse(text || '{}'),
        providerToken: {
          claims: decode(claims),
          header: decode(header),
          signed: verify(
            'sha256',
            Buffer.from(`${header}.${claims}`),
            { dsaEncoding: 'ieee-p1363', key: publicKey },
            Buffer.from(signature, 'base64url'),
          ),
        },
        token,
      });
      if (token.startsWith('gone')) {
        response.writeHead(410, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ reason: 'Unregistered', timestamp: Date.now() }));
        return;
      }
      response.writeHead(200);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { close: () => server.close(), sent };
};

/** One call the coding gateway made: the key it sent and the model it asked for. */
export interface AnthropicCall {
  apiKey: string;
  model: string;
  stream: boolean;
  text: string;
}

/**
 * The provider behind the coding gateway, in Anthropic's format: `/v1/messages`, streamed or
 * not, with usage in `message_start` and `message_delta` as the gateway meters it. Point the
 * server at it with CODING_BASE_URL=http://127.0.0.1:<port>.
 */
export const startFakeAnthropic = async (port: number) => {
  const calls: AnthropicCall[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !(req.url ?? '').endsWith('/v1/messages')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not here', type: 'not_found_error' } }));
      return;
    }
    const body = await readJson(req);
    const said = (body.messages ?? [])
      .filter((message: any) => message.role === 'user')
      .map((message: any) => textOf(message.content))
      .join('\n');
    calls.push({
      apiKey: String(req.headers['x-api-key'] ?? ''),
      model: body.model,
      stream: body.stream === true,
      text: said,
    });
    const text = /readme/i.test(said) ? 'I will add a README.' : 'three things worth knowing.';
    const id = `msg_${Date.now()}`;
    const usage = { input_tokens: 1200, output_tokens: 300 };
    if (body.stream !== true) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ text, type: 'text' }],
          id,
          model: body.model,
          role: 'assistant',
          stop_reason: 'end_turn',
          type: 'message',
          usage,
        }),
      );
      return;
    }
    res.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream' });
    const events: [string, object][] = [
      [
        'message_start',
        {
          message: {
            content: [],
            id,
            model: body.model,
            role: 'assistant',
            type: 'message',
            usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
          },
          type: 'message_start',
        },
      ],
      [
        'content_block_start',
        { content_block: { text: '', type: 'text' }, index: 0, type: 'content_block_start' },
      ],
      [
        'content_block_delta',
        { delta: { text, type: 'text_delta' }, index: 0, type: 'content_block_delta' },
      ],
      ['content_block_stop', { index: 0, type: 'content_block_stop' }],
      [
        'message_delta',
        {
          delta: { stop_reason: 'end_turn' },
          type: 'message_delta',
          usage: { output_tokens: usage.output_tokens },
        },
      ],
      ['message_stop', { type: 'message_stop' }],
    ];
    for (const [event, data] of events)
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
  });
  await listen(server, port);
  return { calls, close: () => server.close() };
};

/** A branch GitHub was asked to make, with its commit and the files in it. */
export interface GithubPush {
  branch: string;
  files: Record<string, string | null>;
  message: string;
  pullRequest?: { base: string; head: string; title: string };
}

/**
 * GitHub as the Biber GitHub App sees it: one installation (77) on the account `acme`, holding
 * one repository, acme/demo, whose default branch is `main`. It authorizes the code `smoke-code`
 * for a user who may use that installation, hands out a new installation token each time (all
 * kept in `tokens`), serves the repository as a real tarball behind a short-lived link, and keeps
 * every branch, commit and pull request it is asked to make. Point the server at it with
 * GITHUB_API_URL and GITHUB_WEB_URL=http://127.0.0.1:<port>.
 */
export const startFakeGithub = async (port: number) => {
  const base = `http://127.0.0.1:${port}`;
  const headSha = 'a'.repeat(40);
  const tokens: string[] = [];
  const calls: { method: string; path: string }[] = [];
  const pushes: GithubPush[] = [];
  const blobs = new Map<string, string>();
  const trees = new Map<string, Record<string, string | null>>();
  const commits = new Map<string, { message: string; tree: string }>();

  // The repository's contents, as the archive GitHub serves: one top folder, named for the commit
  const source = mkdtempSync(path.join(tmpdir(), 'biber-github-'));
  const top = `acme-demo-${headSha.slice(0, 7)}`;
  mkdirSync(path.join(source, top, 'src'), { recursive: true });
  writeFileSync(path.join(source, top, 'package.json'), '{ "name": "demo", "version": "1.0.0" }\n');
  writeFileSync(path.join(source, top, 'src', 'index.js'), "console.log('demo');\n");
  execFileSync('tar', ['-czf', path.join(source, 'demo.tar.gz'), '-C', source, top]);
  const tarball = readFileSync(path.join(source, 'demo.tar.gz'));

  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    const method = req.method ?? 'GET';
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    calls.push({ method, path: `${url.pathname}${url.search}` });
    const body = method === 'POST' ? await readJson(req).catch(() => ({})) : {};

    if (url.pathname === '/login/oauth/access_token') {
      return json(res, 200, body.code === 'smoke-code' ? { access_token: 'gho_user' } : {});
    }
    if (url.pathname === '/user/installations') {
      if (auth !== 'gho_user') return json(res, 401, { message: 'Bad credentials' });
      return json(res, 200, { installations: [{ id: 77 }] });
    }
    // The App's own JWT
    if (url.pathname.startsWith('/app/')) {
      if (!auth.startsWith('eyJ')) return json(res, 401, { message: 'A JSON web token is needed' });
      if (url.pathname === '/app/installations/77') {
        return json(res, 200, { account: { login: 'acme', type: 'Organization' } });
      }
      if (url.pathname === '/app/installations/77/access_tokens' && method === 'POST') {
        const token = `ghs_smoke${randomBytes(12).toString('hex')}`;
        tokens.push(token);
        return json(res, 201, { token });
      }
      return json(res, 404, { message: 'Not Found' });
    }
    // GitHub's short-lived download link, which needs no token
    if (url.pathname === `/codeload/acme/demo/legacy.tar.gz/${headSha}`) {
      res.writeHead(200, { 'Content-Type': 'application/x-gzip' });
      res.end(tarball);
      return;
    }

    // Everything else needs an installation token
    if (!tokens.includes(auth)) return json(res, 401, { message: 'Bad credentials' });
    if (url.pathname === '/installation/repositories') {
      return json(res, 200, {
        repositories: [{ default_branch: 'main', full_name: 'acme/demo', private: true }],
        total_count: 1,
      });
    }
    const repo = /^\/repos\/acme\/demo(\/.*)$/.exec(url.pathname)?.[1];
    if (!repo) return json(res, 404, { message: 'Not Found' });
    if (repo === '/commits/main' || repo === `/commits/${headSha}`) {
      return json(res, 200, { sha: headSha });
    }
    if (repo === `/tarball/${headSha}`) {
      res.writeHead(302, {
        Location: `${base}/codeload/acme/demo/legacy.tar.gz/${headSha}?token=short-lived`,
      });
      res.end();
      return;
    }
    if (repo === `/git/commits/${headSha}`) return json(res, 200, { tree: { sha: 'tree-base' } });
    if (repo === '/git/blobs' && method === 'POST') {
      const sha = `blob-${blobs.size + 1}`;
      blobs.set(sha, Buffer.from(body.content ?? '', 'base64').toString('utf8'));
      return json(res, 201, { sha });
    }
    if (repo === '/git/trees' && method === 'POST') {
      const sha = `tree-${trees.size + 1}`;
      trees.set(
        sha,
        Object.fromEntries(
          (body.tree ?? []).map((entry: { path: string; sha: string | null }) => [
            entry.path,
            entry.sha === null ? null : (blobs.get(entry.sha) ?? ''),
          ]),
        ),
      );
      return json(res, 201, { sha });
    }
    if (repo === '/git/commits' && method === 'POST') {
      const sha = randomBytes(20).toString('hex');
      commits.set(sha, { message: body.message, tree: body.tree });
      return json(res, 201, { sha });
    }
    if (repo === '/git/refs' && method === 'POST') {
      const commit = commits.get(body.sha);
      if (!commit) return json(res, 422, { message: 'Object does not exist' });
      pushes.push({
        branch: String(body.ref).replace('refs/heads/', ''),
        files: trees.get(commit.tree) ?? {},
        message: commit.message,
      });
      return json(res, 201, { ref: body.ref });
    }
    if (repo === '/pulls' && method === 'POST') {
      const push = pushes.find((item) => item.branch === body.head);
      if (!push) return json(res, 422, { message: 'No such branch' });
      push.pullRequest = { base: body.base, head: body.head, title: body.title };
      const number = pushes.indexOf(push) + 1;
      return json(res, 201, { html_url: `${base}/acme/demo/pull/${number}`, number });
    }
    return json(res, 404, { message: 'Not Found' });
  });
  await listen(server, port);
  return { calls, close: () => server.close(), pushes, tokens };
};
