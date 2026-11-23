#!/usr/bin/env node
/**
 * A stand-in for the `claude` CLI on the coding computer, for scripts/biber/smoke/coding.ts. It
 * speaks what `lh hetero exec` reads from Claude Code (`-p --input-format stream-json
 * --output-format stream-json`), calls the model through the server's coding gateway with the
 * run's token as Claude Code would, and calls Biber's coding tools on the `lobe_cc` MCP server
 * named in `--mcp-config`. What it does depends on the request:
 *
 * - "README": lists the user's repositories, opens acme/demo, adds a README, asks to push it (and
 *   waits for the answer on the phone), then hands the README over with deliver_file;
 * - "take your time" / "慢慢来": says it started, then works until it is stopped;
 * - anything else: answers in a line that starts with "Coder here:".
 *
 * Every run writes what it was given (its environment and arguments) to `.biber-smoke-run.json`
 * in its working directory, where the smoke run looks for credentials that must not be there.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
// What `lh` checks the binary with before using it
if (args.includes('--version')) {
  process.stdout.write('2.1.319 (Claude Code)\n');
  process.exit(0);
}
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const sessionId = option('--resume') ?? randomUUID();
/** Its output stream, also kept in the working directory for a failed smoke run to show */
const print = (event) => {
  const line = `${JSON.stringify({ ...event, session_id: sessionId })}\n`;
  process.stdout.write(line);
  appendFileSync(path.join(process.cwd(), '.biber-smoke-stream.jsonl'), line);
};

let turn = 0;
const say = (text) => {
  turn += 1;
  print({
    message: {
      content: [{ text, type: 'text' }],
      id: `msg_fake_${turn}`,
      model: 'claude-fake',
      role: 'assistant',
      type: 'message',
    },
    type: 'assistant',
  });
};

/** The prompt, from the stream-json user message on stdin. */
const readPrompt = async () => {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.includes('\n')) break;
  }
  const texts = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const content = JSON.parse(line).message?.content;
    if (typeof content === 'string') texts.push(content);
    else for (const block of content ?? []) if (block.type === 'text') texts.push(block.text);
  }
  return texts.join('\n');
};

/** One call to the model through the server's gateway, streamed, as Claude Code makes it. */
const askModel = async (prompt) => {
  const response = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
    body: JSON.stringify({
      max_tokens: 256,
      messages: [{ content: prompt, role: 'user' }],
      model: 'claude-sonnet-fake',
      stream: true,
    }),
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
    },
    method: 'POST',
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`the model refused (${response.status}): ${body}`);
  let text = '';
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = JSON.parse(line.slice(5));
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
      text += data.delta.text;
    }
  }
  return text;
};

/** A client of the run's `lobe_cc` MCP server (streamable HTTP). */
const mcp = async () => {
  const config = JSON.parse(await readFile(option('--mcp-config'), 'utf8'));
  const url = config.mcpServers.lobe_cc.url;
  let session;
  let nextId = 0;

  const post = async (body) => {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'accept': 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(session && { 'mcp-session-id': session }),
      },
      method: 'POST',
    });
    session ??= response.headers.get('mcp-session-id') ?? undefined;
    if (body.id === undefined) return;
    const raw = await response.text();
    const messages = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      ? raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => JSON.parse(line.slice(5)))
      : [JSON.parse(raw)];
    const answer = messages.find((message) => message.id === body.id);
    if (!answer) throw new Error(`no answer from lobe_cc: ${raw.slice(0, 500)}`);
    if (answer.error) throw new Error(`lobe_cc: ${answer.error.message}`);
    return answer.result;
  };

  await post({
    id: nextId++,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'fake-claude', version: '0' },
      protocolVersion: '2025-03-26',
    },
  });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  /** Calls a tool the way Claude Code does: a tool_use in the stream, the call, its result. */
  return async (tool, input) => {
    const id = `toolu_fake_${randomUUID().slice(0, 8)}`;
    turn += 1;
    print({
      message: {
        content: [{ id, input, name: `mcp__lobe_cc__${tool}`, type: 'tool_use' }],
        id: `msg_fake_${turn}`,
        model: 'claude-fake',
        role: 'assistant',
        type: 'message',
      },
      type: 'assistant',
    });
    const result = await post({
      id: nextId++,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { _meta: { 'claudecode/toolUseId': id }, arguments: input, name: tool },
    });
    const text = (result.content ?? []).map((block) => block.text ?? '').join('\n');
    print({
      message: {
        content: [
          { content: text, is_error: !!result.isError, tool_use_id: id, type: 'tool_result' },
        ],
        role: 'user',
      },
      type: 'user',
    });
    return { isError: !!result.isError, text };
  };
};

const main = async () => {
  const cwd = process.cwd();
  await writeFile(
    path.join(cwd, '.biber-smoke-run.json'),
    JSON.stringify({ args, env: process.env }, null, 2),
  );
  print({ cwd, model: 'claude-fake', subtype: 'init', tools: [], type: 'system' });

  const prompt = await readPrompt();
  // The user's words come last, after Biber's context for the run
  const request = prompt.split('\n').findLast(Boolean) ?? '';
  let reply;

  if (/take your time|慢慢来/i.test(request)) {
    say('Started; this will take a while.');
    // Works until it is stopped
    await new Promise((done) => setTimeout(done, 30 * 60 * 1000));
    reply = 'Finished at last.';
  } else if (/readme/i.test(request)) {
    const answer = await askModel(request);
    say(answer);
    const call = await mcp();
    const repos = await call('list_repos', {});
    if (!repos.text.includes('acme/demo')) throw new Error(`no acme/demo in ${repos.text}`);
    // A directory of its own each time, as open_repo wants an empty one
    const directory = `demo-${randomUUID().slice(0, 6)}`;
    const opened = await call('open_repo', { directory, repository: 'acme/demo' });
    if (opened.isError) throw new Error(opened.text);
    await mkdir(path.join(cwd, directory), { recursive: true });
    await writeFile(path.join(cwd, directory, 'README.md'), '# Demo\n\nWhat this project does.\n');
    const pushed = await call('push_changes', {
      body: 'Adds a README that says what the project does.',
      directory,
      title: 'Add a README',
    });
    if (pushed.isError) {
      reply = `Not pushed. ${pushed.text}`;
    } else {
      await call('deliver_file', { path: `${directory}/README.md` });
      reply = `Pushed. ${pushed.text}`;
    }
  } else {
    // Two turns, so the answer lands in a step of its own, as a longer run's would
    say('Looking into it.');
    reply = `Coder here: ${await askModel(request)}`;
  }

  say(reply);
  print({
    duration_ms: 10,
    is_error: false,
    num_turns: turn,
    result: reply,
    subtype: 'success',
    type: 'result',
    usage: { input_tokens: 10, output_tokens: 10 },
  });
};

main().catch((error) => {
  say(`Failed: ${error.message}`);
  print({
    is_error: true,
    result: String(error.message),
    subtype: 'error_during_execution',
    type: 'result',
  });
  process.exitCode = 1;
});
