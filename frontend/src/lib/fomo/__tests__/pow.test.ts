import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hexToBytes, powDigestLeading, solvePow, verifyPow } from "../pow";

describe("faucet proof of work", () => {
  const challenge = hexToBytes("0x" + "ab".repeat(120));

  it("decodes hex challenges and rejects odd input", () => {
    expect(hexToBytes("0x0aff")).toEqual(Uint8Array.from([10, 255]));
    expect(() => hexToBytes("0xabc")).toThrow(/hex/);
  });

  it("finds a nonce for an easy target and the verifier agrees", () => {
    const target = 1n << 60n;
    const nonce = solvePow(challenge, target, 7n);
    expect(nonce).not.toBeNull();
    expect(verifyPow(challenge, nonce!, target)).toBe(true);
    expect(powDigestLeading(challenge, nonce!) < target).toBe(true);
  });

  it("gives up after the iteration budget on an impossible target", () => {
    expect(solvePow(challenge, 0n, 0n, 50)).toBeNull();
  });

  it("is deterministic for a given nonce", () => {
    expect(powDigestLeading(challenge, 42n)).toBe(powDigestLeading(challenge, 42n));
    expect(powDigestLeading(challenge, 42n)).not.toBe(powDigestLeading(challenge, 43n));
  });

  it("matches the faucet protocol computed independently: sha256(challenge || nonce as u64 big-endian), first 8 bytes big-endian", () => {
    const nonce = 0x0102030405060708n;
    const input = Buffer.concat([Buffer.from(challenge), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]);
    const expected = createHash("sha256").update(input).digest().readBigUInt64BE(0);
    expect(powDigestLeading(challenge, nonce)).toBe(expected);
    // A solved nonce is accepted by the same independent computation.
    const solved = solvePow(challenge, 1n << 60n, 7n)!;
    const check = Buffer.alloc(8);
    check.writeBigUInt64BE(solved);
    const leading = createHash("sha256").update(Buffer.concat([Buffer.from(challenge), check])).digest().readBigUInt64BE(0);
    expect(leading < 1n << 60n).toBe(true);
  });
});
