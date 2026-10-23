import { sha256 } from "@noble/hashes/sha2.js";

/** Faucet proof of work: the first eight digest bytes, big-endian, must be below `target`. */
export function powDigestLeading(challenge: Uint8Array, nonce: bigint): bigint {
  const input = new Uint8Array(challenge.length + 8);
  input.set(challenge);
  new DataView(input.buffer).setBigUint64(challenge.length, nonce);
  const digest = sha256(input);
  return new DataView(digest.buffer, digest.byteOffset, 8).getBigUint64(0);
}

export const verifyPow = (challenge: Uint8Array, nonce: bigint, target: bigint) =>
  powDigestLeading(challenge, nonce) < target;

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(clean)) throw new Error("Invalid hex challenge.");
  return Uint8Array.from(clean.match(/../g)!, (byte) => parseInt(byte, 16));
}

/** Brute-forces a nonce; runs for at most `maxIterations` before giving up with null. */
export function solvePow(
  challenge: Uint8Array,
  target: bigint,
  startNonce: bigint = BigInt.asUintN(64, BigInt(Math.floor(Math.random() * 2 ** 52))),
  maxIterations = 50_000_000,
): bigint | null {
  const input = new Uint8Array(challenge.length + 8);
  input.set(challenge);
  const view = new DataView(input.buffer);
  let nonce = startNonce;
  for (let i = 0; i < maxIterations; i++) {
    view.setBigUint64(challenge.length, nonce);
    const digest = sha256(input);
    if (new DataView(digest.buffer, digest.byteOffset, 8).getBigUint64(0) < target) return nonce;
    nonce = BigInt.asUintN(64, nonce + 1n);
  }
  return null;
}
