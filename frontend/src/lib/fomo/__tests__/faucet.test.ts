import { describe, expect, it, vi } from "vitest";
import { readPowTarget, requestFaucetTokens } from "../faucet";

describe("readPowTarget", () => {
  it("keeps 64-bit targets exact", () => {
    expect(readPowTarget('{"challenge":"0x00","target":18446744073709551615,"timestamp":1}')).toBe(18446744073709551615n);
    expect(() => readPowTarget('{"challenge":"0x00"}')).toThrow(/target/);
    expect(() => readPowTarget('{"target":0}')).toThrow(/Invalid/);
    expect(() => readPowTarget('{"target":18446744073709551616}')).toThrow(/Invalid/);
    expect(() => readPowTarget('{"target":1.5}')).toThrow(/target/);
    expect(() => readPowTarget('{"target":1e3}')).toThrow(/target/);
  });
});

describe("requestFaucetTokens", () => {
  const responses: Record<string, string> = {
    get_metadata: '{"version":"0.17.1","id":"mtst1faucet","base_amount":100000000,"decimals":6}',
    pow: '{"challenge":"0xabcd","target":17592186044416,"timestamp":5}',
    get_tokens: `{"note_id":"0x${"1f".repeat(32)}"}`,
  };
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname.split("/").pop()!;
    return new Response(responses[path] ?? "missing", { status: responses[path] ? 200 : 404 });
  }) as unknown as typeof fetch;

  it("claims base_amount with the solved nonce and returns the note id", async () => {
    const solve = vi.fn(async () => 99n);
    const statuses: string[] = [];
    const account = "0x" + "ab".repeat(15);
    const grant = await requestFaucetTokens(account, {
      baseUrl: "https://faucet.example/",
      fetchImpl,
      solve,
      onStatus: (text) => statuses.push(text),
    });
    expect(grant).toEqual({ noteId: `0x${"1f".repeat(32)}`, amount: 100_000_000n, faucetWalletId: "mtst1faucet" });
    expect(solve).toHaveBeenCalledWith("0xabcd", 17592186044416n);
    const calls = vi.mocked(fetchImpl).mock.calls.map((call) => String(call[0]));
    expect(calls[0]).toBe("https://faucet.example/get_metadata");
    expect(calls[1]).toBe(`https://faucet.example/pow?account_id=${account}&amount=100000000`);
    expect(calls[2]).toBe(`https://faucet.example/get_tokens?account_id=${account}&asset_amount=100000000&challenge=0xabcd&nonce=99`);
    expect(statuses.length).toBeGreaterThan(2);
  });

  it("surfaces faucet HTTP errors with the body", async () => {
    const failing = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    await expect(requestFaucetTokens("0x00", { baseUrl: "https://f", fetchImpl: failing, solve: async () => 1n })).rejects.toThrow(
      /HTTP 429 rate limited/,
    );
  });

  it("retries a 503 on the challenge fetch with a fresh challenge", async () => {
    let pows = 0;
    const flaky = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname.split("/").pop()!;
      if (path === "pow" && ++pows === 1) return new Response("busy", { status: 503 });
      return new Response(responses[path], { status: 200 });
    }) as unknown as typeof fetch;
    const solve = vi.fn(async () => 7n);
    const grant = await requestFaucetTokens("0x00", { baseUrl: "https://f", fetchImpl: flaky, solve, retryDelayMs: 0 });
    expect(pows).toBe(2);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(grant.amount).toBe(100_000_000n);
  });

  it("gives up after the configured attempts on a persistent 503", async () => {
    let pows = 0;
    const busy = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname.split("/").pop()!;
      if (path === "pow") pows++;
      return path === "pow" ? new Response("busy", { status: 503 }) : new Response(responses[path], { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      requestFaucetTokens("0x00", { baseUrl: "https://f", fetchImpl: busy, solve: async () => 1n, attempts: 2, retryDelayMs: 0 }),
    ).rejects.toThrow(/HTTP 503/);
    expect(pows).toBe(2);
  });
});
