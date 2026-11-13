/**
 * For smoke runs only: sends the server's requests to some outside APIs to local stand-ins
 * instead, so a messaging bot can be exercised end to end without an account with that service.
 * Load it into the server with Node's --import, and name the hosts to redirect:
 *
 *   SMOKE_REDIRECT_HOSTS=api.telegram.org=http://127.0.0.1:4050,api.linqapp.com=http://127.0.0.1:4060 \
 *   NODE_OPTIONS="--import ./scripts/biber/smoke/redirect-hosts.mjs" bun run dev
 *
 * It replaces the global fetch, which the Telegram, Linq and Lark clients use, and only the scheme,
 * host and port change. Without SMOKE_REDIRECT_HOSTS it does nothing.
 */
const spec = process.env.SMOKE_REDIRECT_HOSTS;

if (spec) {
  const targets = new Map(
    spec
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), new URL(pair.slice(at + 1))];
      }),
  );
  const originalFetch = globalThis.fetch;

  globalThis.fetch = function redirectedFetch(input, init) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    let url;
    try {
      url = new URL(href);
    } catch {
      return originalFetch.call(this, input, init);
    }
    const target = targets.get(url.host);
    if (!target) return originalFetch.call(this, input, init);

    const redirected = new URL(`${url.pathname}${url.search}`, target.origin);
    if (input instanceof Request) {
      return originalFetch.call(this, new Request(redirected, input), init);
    }
    return originalFetch.call(this, redirected, init);
  };

  console.log(`[smoke] redirecting ${[...targets.keys()].join(', ')} to local stand-ins`);
}
