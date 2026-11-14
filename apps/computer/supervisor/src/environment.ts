import { createHmac } from "node:crypto";

/**
 * The token one computer accepts: an HMAC of its Bot id under the deployment's COMPUTER_TOKEN.
 *
 * Each computer holds only its own, so a command run on one computer can read that token from its
 * environment and still reach no other computer. The Biber server derives the same value to call
 * it (`computerTokenFor` in apps/server/src/services/sandbox/providers/openbot.ts); keep the two
 * identical.
 */
export function computerTokenFor(secret: string, botId: string): string {
  return createHmac("sha256", secret).update(`computer:${botId}`).digest("hex");
}

/**
 * What a computer is told about itself.
 *
 * Kept separate from the HTTP server so the exact environment boundary is testable without
 * starting a listener or connecting to Docker. Nothing here is caller-supplied: a request says
 * which Bot, never what to run or what to set.
 */
export function environmentFor(
  botId: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const passthrough = Object.entries(env).filter(([key]) =>
    key.startsWith("EGRESS_PROXY"),
  );
  const computerToken = env.COMPUTER_TOKEN?.trim() || undefined;
  const spireSocketVolume = env.SPIRE_AGENT_SOCKET_VOLUME;
  // Fail fast here rather than forwarding an invalid mode that crashes the child at
  // `browserModeFromEnv`: whitespace-only is falsy after trim, anything else must be headless
  // or headed.
  const rawBrowserMode = env.COMPUTER_BROWSER_MODE?.trim() || undefined;
  if (
    rawBrowserMode !== undefined &&
    rawBrowserMode !== "headless" &&
    rawBrowserMode !== "headed"
  ) {
    throw new Error(
      `COMPUTER_BROWSER_MODE must be headless or headed, not ${JSON.stringify(env.COMPUTER_BROWSER_MODE)}.`,
    );
  }
  const browserMode = rawBrowserMode;
  return [
    `COMPUTER_BOT_ID=${botId}`,
    ...(computerToken
      ? [`COMPUTER_TOKEN=${computerTokenFor(computerToken, botId)}`]
      : []),
    ...(spireSocketVolume
      ? ["SPIFFE_ENDPOINT_SOCKET=/tmp/spire-agent/public/api.sock"]
      : []),
    ...(browserMode ? [`COMPUTER_BROWSER_MODE=${browserMode}`] : []),
    ...passthrough.map(([key, value]) => `${key}=${value ?? ""}`),
  ];
}
