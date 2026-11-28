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
 * The model and how it decides are in `./model.ts`. Point the server at them with OPENAI_PROXY_URL=http://127.0.0.1:<model>/v1 and
 * EXPO_BASE_URL=http://127.0.0.1:<push>.
 */
import { execFileSync } from 'node:child_process';
import { createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttp2Server } from 'node:http2';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { tomorrowInChina } from './model';
import { listen, readJson, textOf } from './utils';

// The stand-in model lives in its own module; smokes import everything from here
export * from './model';

export interface PushRequest {
  body: string;
  /** The notification category that gives it buttons, when it has any */
  categoryId?: string;
  data?: Record<string, string>;
  title: string;
  to: string;
}

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
