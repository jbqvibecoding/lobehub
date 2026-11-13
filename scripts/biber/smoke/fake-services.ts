/**
 * Stand-ins for the services a Biber server calls out to, so a smoke run needs no accounts:
 *
 * - an OpenAI-compatible model that, when a request offers the cloud computer's code tool and the
 *   user asked to run code, calls that tool; once the tool has answered, it replies in text;
 * - Expo's push service, recording every notification it is asked to send.
 *
 * Point the server at them with OPENAI_PROXY_URL=http://127.0.0.1:<model>/v1 and
 * EXPO_BASE_URL=http://127.0.0.1:<push>.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const CODE_TOOL = 'lobe-cloud-sandbox____executeCode';

export interface ModelRequest {
  messages: { content?: unknown; role: string }[];
  model: string;
  path: string;
  tools: string[];
}

export interface PushRequest {
  body: string;
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
export const decideReply = (
  request: Pick<ModelRequest, 'messages' | 'tools'>,
): { text: string } | { toolCall: { arguments: string; name: string } } => {
  const lastUser = request.messages.findLastIndex((m) => m.role === 'user');
  const toolAnswered = request.messages.slice(lastUser + 1).some((m) => m.role === 'tool');
  const askedToRunCode = /run code/i.test(textOf(request.messages[lastUser]?.content));

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

    if (!path.endsWith('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `fake model does not serve ${path}` } }));
      return;
    }
    const reply = decideReply(request);
    if (body.stream === false) {
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
      sent.push({ tenant, text: messageText(), to: body.receive_id });
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
