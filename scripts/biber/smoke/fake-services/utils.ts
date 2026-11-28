/** Helpers the stand-ins share: reading a request, listening, the text of a message. */
import type { IncomingMessage, Server } from 'node:http';

export const readJson = async (req: IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
};

export const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => part?.text ?? '').join('')
      : '';

export const listen = (server: Server, port: number) =>
  new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
