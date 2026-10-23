import { describe, expect, it } from "vitest";
import { buyKey, loadBuys, saveBuy, updateBuy, type BuyRecord, type BuyStore } from "../buys";

const memoryStore = (): BuyStore => {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
};

const record = (at: number, noteId?: string): BuyRecord => ({
  noteId,
  maxSpend: "1000000",
  priceAtBuy: "1000000",
  round: 3,
  at,
});

describe("buy records store", () => {
  it("saves newest first, keyed by game, and survives a reload", () => {
    const store = memoryStore();
    saveBuy("0xGAME", record(1, "0xa"), store);
    saveBuy("0xgame", record(2, "0xb"), store);
    expect(loadBuys("0xGame", store).map((b) => b.noteId)).toEqual(["0xb", "0xa"]);
    expect(loadBuys("0xother", store)).toEqual([]);
  });

  it("replaces a record with the same moment and note id, and patches fields", () => {
    const store = memoryStore();
    saveBuy("g", record(1, "0xa"), store);
    saveBuy("g", { ...record(1, "0xa"), maxSpend: "2" }, store);
    saveBuy("g", record(1, "0xb"), store);
    updateBuy("g", { at: 1, noteId: "0xa" }, { txHash: "0xtx", walletTxId: "w1" }, store);
    const buys = loadBuys("g", store);
    expect(buys.map(buyKey)).toEqual(["1:0xb", "1:0xa"]);
    expect(buys[1]).toMatchObject({ maxSpend: "2", txHash: "0xtx", walletTxId: "w1" });
    expect(buys[0].txHash).toBeUndefined();
  });

  it("tolerates a missing or broken store", () => {
    expect(loadBuys("g", null)).toEqual([]);
    expect(saveBuy("g", record(1), null)).toHaveLength(1);
    const broken: BuyStore = { getItem: () => "{not json", setItem: () => {} };
    expect(loadBuys("g", broken)).toEqual([]);
    expect(updateBuy("g", { at: 1 }, { txHash: "x" }, broken)).toEqual([]);
  });
});
