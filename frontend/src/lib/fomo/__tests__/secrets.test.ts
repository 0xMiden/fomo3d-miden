import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, loadKeys, saveKey, secretOf, updateKey, type KeyRecord, type KeyStore } from "../secrets";

const memoryStore = (): KeyStore => {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
};

const record = (commitment: string): KeyRecord => ({
  commitment,
  secret: ["1", "2", "3", "18446744069414584320"],
  refundTemplate: "AAEC",
  maxSpend: "1000000",
  priceAtBuy: "1000000",
  at: 1,
});

describe("key secrets store", () => {
  it("saves newest first, keyed by game, and survives a reload", () => {
    const store = memoryStore();
    saveKey("0xGAME", record("0xa"), store);
    saveKey("0xgame", record("0xb"), store);
    expect(loadKeys("0xGame", store).map((k) => k.commitment)).toEqual(["0xb", "0xa"]);
    expect(loadKeys("0xother", store)).toEqual([]);
  });

  it("replaces a record with the same commitment and patches fields", () => {
    const store = memoryStore();
    saveKey("g", record("0xa"), store);
    saveKey("g", { ...record("0xa"), maxSpend: "2" }, store);
    updateKey("g", "0xa", { txHash: "0xtx" }, store);
    const keys = loadKeys("g", store);
    expect(keys).toHaveLength(1);
    expect(keys[0].maxSpend).toBe("2");
    expect(keys[0].txHash).toBe("0xtx");
  });

  it("tolerates a missing or broken store", () => {
    expect(loadKeys("g", null)).toEqual([]);
    expect(saveKey("g", record("0xa"), null)).toHaveLength(1);
    const broken: KeyStore = { getItem: () => "{not json", setItem: () => {} };
    expect(loadKeys("g", broken)).toEqual([]);
  });

  it("round-trips secrets and bytes", () => {
    expect(secretOf(record("x"))).toEqual([1n, 2n, 3n, 18446744069414584320n]);
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
