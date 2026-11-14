import { describe, expect, test } from "bun:test";
import { computerTokenFor, environmentFor } from "../src/environment";

describe("what the supervisor tells a computer about its browser", () => {
  test("passes the deployment's browser mode to every per-Bot computer", () => {
    expect(
      environmentFor("invoice-collector", {
        COMPUTER_TOKEN: "secret",
        COMPUTER_BROWSER_MODE: "headed",
      }),
    ).toEqual([
      "COMPUTER_BOT_ID=invoice-collector",
      `COMPUTER_TOKEN=${computerTokenFor("secret", "invoice-collector")}`,
      "COMPUTER_BROWSER_MODE=headed",
    ]);
  });

  test("does not invent a browser mode when the deployment left it unset", () => {
    expect(
      environmentFor("invoice-collector", { COMPUTER_TOKEN: "secret" }),
    ).toEqual([
      "COMPUTER_BOT_ID=invoice-collector",
      `COMPUTER_TOKEN=${computerTokenFor("secret", "invoice-collector")}`,
    ]);
  });
});

describe("the token each computer holds", () => {
  const tokenOf = (botId: string) =>
    environmentFor(botId, { COMPUTER_TOKEN: "deployment-secret" })
      .find((line) => line.startsWith("COMPUTER_TOKEN="))
      ?.slice("COMPUTER_TOKEN=".length);

  // Pinned in apps/server/src/services/sandbox/providers/openbot.test.ts too: the Biber server
  // derives the same token to call a computer
  test("is derived the same way the Biber server derives it", () => {
    expect(computerTokenFor("secret", "bot-1")).toBe(
      "260314326e66c3a2cb0305df0d59da1480fee67461d9793f4bb8ef6f701bebd6",
    );
  });

  test("is never the deployment secret itself", () => {
    expect(tokenOf("u-alice")).not.toBe("deployment-secret");
    expect(tokenOf("u-alice")).toMatch(/^[0-9a-f]{64}$/);
  });

  // A command on one user's computer can read its own token; it must not open anyone else's
  test("differs from one computer to the next", () => {
    expect(tokenOf("u-alice")).not.toBe(tokenOf("u-bob"));
    expect(tokenOf("u-alice")).toBe(tokenOf("u-alice"));
  });
});
