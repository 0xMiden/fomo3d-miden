import { FAUCET_URL } from "@/config";
import type { PowRequest, PowResponse } from "./pow.worker";

export type PowSolver = (challengeHex: string, target: bigint) => Promise<bigint>;

/** Solves the proof of work off the main thread. */
export const workerPowSolver: PowSolver = (challengeHex, target) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<PowResponse>) => {
      worker.terminate();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(BigInt(event.data.nonce));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Proof of work worker failed."));
    };
    worker.postMessage({ challengeHex, target: target.toString() } satisfies PowRequest);
  });

/** `target` can exceed 2^53, so it is read from the raw JSON text, never from `JSON.parse`. */
export function readPowTarget(rawJson: string): bigint {
  const match = /"target"\s*:\s*(\d+)/.exec(rawJson);
  if (!match) throw new Error("Faucet pow response lacks a target.");
  const target = BigInt(match[1]);
  if (target <= 0n || target > 1n << 64n) throw new Error("Invalid faucet PoW target.");
  return target;
}

export type FaucetGrant = { noteId: string; amount: bigint; faucetWalletId: string };

/**
 * Requests the faucet's full `base_amount` grant as a public P2ID note for `accountId` (hex or
 * bech32). Bread auto-consumes native-asset grants once its sync sees the note.
 */
export async function requestFaucetTokens(
  accountId: string,
  options: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    solve?: PowSolver;
    onStatus?: (text: string) => void;
    /** Fresh-challenge attempts on 503/429. Default 4. */
    attempts?: number;
  } = {},
): Promise<FaucetGrant> {
  const configured = options.baseUrl ?? FAUCET_URL;
  if (!configured) throw new Error("This network has no faucet.");
  const base = configured.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const solve = options.solve ?? workerPowSolver;
  const status = options.onStatus ?? (() => {});
  const get = async (path: string, params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    const response = await fetchImpl(`${base}/${path}${query}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    const text = await response.text();
    if (!response.ok) throw new Error(`Faucet ${path}: HTTP ${response.status} ${text}`);
    return text;
  };

  status("Reading faucet metadata...");
  const metadata = JSON.parse(await get("get_metadata")) as { base_amount?: number | string; id?: string };
  const amount = String(metadata.base_amount ?? "");
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error("Faucet returned an invalid base amount.");

  // A challenge expires after about 30 s and the faucet answers 503 under load, so each
  // retry fetches and solves a fresh challenge.
  const attempts = options.attempts ?? 4;
  let result: { note_id?: string } = {};
  for (let attempt = 1; attempt <= attempts; attempt++) {
    status(attempt === 1 ? "Fetching proof of work challenge..." : `Faucet busy; retrying (${attempt}/${attempts})...`);
    const powText = await get("pow", { account_id: accountId, amount });
    const pow = JSON.parse(powText) as { challenge?: string };
    if (typeof pow.challenge !== "string") throw new Error("Faucet pow response lacks a challenge.");
    const target = readPowTarget(powText);

    status("Solving proof of work (a few seconds)...");
    const nonce = await solve(pow.challenge, target);

    status("Requesting tokens...");
    try {
      result = JSON.parse(
        await get("get_tokens", { account_id: accountId, asset_amount: amount, challenge: pow.challenge, nonce: nonce.toString() }),
      ) as { note_id?: string };
      break;
    } catch (error) {
      const retryable = /HTTP (503|429)/.test(error instanceof Error ? error.message : "");
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  if (typeof result.note_id !== "string" || !/^0x[0-9a-f]{64}$/i.test(result.note_id)) {
    throw new Error("Faucet did not return a valid note id.");
  }
  return { noteId: result.note_id, amount: BigInt(amount), faucetWalletId: String(metadata.id ?? "") };
}
