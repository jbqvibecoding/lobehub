/**
 * Talks to a running Biber server the way the web and phone apps do: better-auth for the session,
 * tRPC over HTTP (superjson) for everything else.
 */
import superjson from 'superjson';

export class SmokeClient {
  private cookies = new Map<string, string>();

  constructor(readonly baseUrl: string) {}

  private cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private remember(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }

  /** POSTs JSON to a better-auth endpoint and keeps the session cookie it sets. */
  async auth<T>(path: string, body: object): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookieHeader(),
        'Origin': this.baseUrl,
      },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    this.remember(response);
    return (await response.json()) as T;
  }

  async signUp(email: string, password: string, name: string) {
    const response = await fetch(`${this.baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({ email, name, password }),
      headers: { 'Content-Type': 'application/json', 'Origin': this.baseUrl },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`sign-up: HTTP ${response.status} ${await response.text()}`);
    this.remember(response);
    return (await response.json()) as { user: { id: string } };
  }

  private async call<T>(
    router: 'lambda' | 'mobile',
    path: string,
    kind: 'mutation' | 'query',
    input?: unknown,
  ): Promise<T> {
    const encoded = superjson.serialize(input ?? null);
    const url = `${this.baseUrl}/trpc/${router}/${path}?batch=1`;
    const response =
      kind === 'query'
        ? await fetch(`${url}&input=${encodeURIComponent(JSON.stringify({ 0: encoded }))}`, {
            headers: { Cookie: this.cookieHeader() },
          })
        : await fetch(url, {
            body: JSON.stringify({ 0: encoded }),
            headers: { 'Content-Type': 'application/json', 'Cookie': this.cookieHeader() },
            method: 'POST',
          });
    const [result] = (await response.json()) as any[];
    if (result?.error) {
      const error = superjson.deserialize(result.error) as { message?: string };
      throw new Error(`${router}.${path}: ${error?.message ?? JSON.stringify(result.error)}`);
    }
    return superjson.deserialize(result.result.data) as T;
  }

  query<T>(router: 'lambda' | 'mobile', path: string, input?: unknown) {
    return this.call<T>(router, path, 'query', input);
  }

  mutation<T>(router: 'lambda' | 'mobile', path: string, input?: unknown) {
    return this.call<T>(router, path, 'mutation', input);
  }
}

/** Polls until `check` returns something, or fails after `timeoutMs`. */
export const waitFor = async <T>(
  what: string,
  check: () => Promise<T | undefined>,
  timeoutMs = 90_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`timed out waiting for ${what}${lastError ? `: ${lastError}` : ''}`);
};
