/// <reference lib="webworker" />
import { hexToBytes, solvePow } from "./pow";

export type PowRequest = { challengeHex: string; target: string };
export type PowResponse = { nonce: string } | { error: string };

self.onmessage = (event: MessageEvent<PowRequest>) => {
  try {
    const nonce = solvePow(hexToBytes(event.data.challengeHex), BigInt(event.data.target));
    const reply: PowResponse = nonce === null ? { error: "Proof of work gave up." } : { nonce: nonce.toString() };
    self.postMessage(reply);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies PowResponse);
  }
};
