# Agent computers

Each user (or each topic) gets a computer of their own: a container with Chromium, a durable
`/workspace`, Python, Node and a shell. LobeHub's Cloud Sandbox tools run on it when
`SANDBOX_PROVIDER=openbot`; the provider is
`apps/server/src/services/sandbox/providers/openbot.ts`.

| Directory         | What it is                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `supervisor/`     | The only process holding the Docker socket. Four verbs: ensure, stop, reset and list a computer.                                         |
| `agent-computer/` | The server inside each computer: `/exec`, `/files/*`, the browser (`/navigate`, `/snapshot`, `/stream`, human takeover, masked secrets). |
| `shared/`         | Types and helpers both of them import.                                                                                                   |

Start them with `compose.yml` in this directory; the environment variables are documented in
`docs/self-hosting/environment-variables/cloud-sandbox.mdx`.

## Where this code comes from

Copied from OpenBot as shipped inside OpenDuet (`openbot/supervisor`, `openbot/agent-computer` and
`openbot/shared`, commit `677e0fcd148d80b99dd788c6d6f9c1c9f40a72db`), MIT licensed, see
`LICENSE.openbot`. Changes made here:

- `agent-computer/Dockerfile` installs `python3`, which the sandbox file tools run.
- `supervisor/src/docker.ts` starts computers with `Init: true`, so finished background commands
  are reaped instead of piling up as zombies against `PidsLimit`.
- `tsconfig.base.json`, `scripts/start-local-chrome-computer.ts` (a test imports it) and the
  `@types/bun` dev dependency came from OpenBot's root and are copied here as they are.
- Each computer gets its own token: the supervisor passes it `HMAC-SHA256(COMPUTER_TOKEN, "computer:" + botId)`
  instead of `COMPUTER_TOKEN` itself, and the Biber server derives the same value to call it. A
  computer the supervisor started for a Bot also refuses requests naming any other Bot. In OpenBot
  every computer held the shared token, so a command run on one user's computer could read it and
  reach every other computer on the network. The supervisor already replaces a computer that holds
  a token it no longer hands out, so existing computers are recreated on their next use.
- Both `bun.lock` files are committed although the repository ignores `*.lock`: the Dockerfiles
  install with `--frozen-lockfile` and need them.

These are Bun projects with their own lockfiles and Biome style. They are not part of the pnpm
workspace and are excluded from the root ESLint and Prettier runs. Their tests run with `bun test`
inside each directory, and in the `Biber CI` workflow (`.github/workflows/biber.yml`).
