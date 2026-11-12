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
