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

  it("matches known answers computed outside this module with sha256(challenge || nonce as u64 big-endian), first 8 bytes big-endian", () => {
    // Generated with Python hashlib: int.from_bytes(sha256(challenge + nonce.to_bytes(8, "big")).digest()[:8], "big").
    expect(powDigestLeading(challenge, 0x0102030405060708n)).toBe(7092583713688754116n);
    expect(powDigestLeading(challenge, 0n)).toBe(8670792641689531080n);
    expect(powDigestLeading(challenge, 42n)).toBe(12987378895291631222n);
  });
});
