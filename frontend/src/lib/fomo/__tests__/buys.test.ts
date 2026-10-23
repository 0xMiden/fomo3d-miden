import { describe, expect, it } from "vitest";
import { buyKey, loadBuys, saveBuy, updateBuy, type BuyRecord, type BuyStore } from "../buys";

const memoryStore = (): BuyStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
};

const record = (at: number, noteId?: string): BuyRecord => ({
  noteId,
  maxSpend: "1000000",
  priceAtBuy: "1000000",
  round: 3,
  at,
});

const ME = "0xAB01";

describe("buy records store", () => {
  it("saves newest first, keyed by game and account, and survives a reload", () => {
    const store = memoryStore();
    let list = saveBuy("0xGAME", ME, [], record(1, "0xa"), store);
    list = saveBuy("0xgame", ME.toLowerCase(), list, record(2, "0xb"), store);
    expect(list.map((b) => b.noteId)).toEqual(["0xb", "0xa"]);
    expect(loadBuys("0xGame", ME, store).map((b) => b.noteId)).toEqual(["0xb", "0xa"]);
    expect(loadBuys("0xother", ME, store)).toEqual([]);
    expect(loadBuys("0xgame", "0xCD02", store)).toEqual([]);
    expect([...store.map.keys()]).toEqual(["fomo3d:buys:0xgame:0xab01"]);
  });

  it("replaces a record with the same moment and note id, and patches fields", () => {
    const store = memoryStore();
    let list = saveBuy("g", ME, [], record(1, "0xa"), store);
    list = saveBuy("g", ME, list, { ...record(1, "0xa"), maxSpend: "2" }, store);
    list = saveBuy("g", ME, list, record(1, "0xb"), store);
    list = updateBuy("g", ME, list, { at: 1, noteId: "0xa" }, { txHash: "0xtx", walletTxId: "w1" }, store);
    const buys = loadBuys("g", ME, store);
    expect(buys.map(buyKey)).toEqual(["1:0xb", "1:0xa"]);
    expect(buys[1]).toMatchObject({ maxSpend: "2", txHash: "0xtx", walletTxId: "w1" });
    expect(buys[0].txHash).toBeUndefined();
    expect(list).toEqual(buys);
  });

  it("keeps the held list when storage is missing, blocked or unreadable", () => {
    expect(loadBuys("g", ME, null)).toEqual([]);
    let list = saveBuy("g", ME, [], record(1, "0xa"), null);
    expect(list).toHaveLength(1);
    list = updateBuy("g", ME, list, { at: 1, noteId: "0xa" }, { txHash: "x" }, null);
    expect(list[0].txHash).toBe("x");
    const broken: BuyStore = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadBuys("g", ME, broken)).toEqual([]);
    list = saveBuy("g", ME, [], record(2, "0xb"), broken);
    expect(updateBuy("g", ME, list, { at: 2, noteId: "0xb" }, { txHash: "y" }, broken)[0]).toMatchObject({ noteId: "0xb", txHash: "y" });
  });

  it("drops malformed stored entries and keeps valid ones, outcome included", () => {
    const store = memoryStore();
    const good = { ...record(9, "0xg"), walletTxId: "w", txHash: "0xt", outcome: "led" };
    store.map.set(
      "fomo3d:buys:g:0xab01",
      JSON.stringify([
        null,
        7,
        [],
        { ...record(1, "0x1"), maxSpend: "nope" },
        { ...record(2, "0x2"), priceAtBuy: "1.5" },
        { ...record(3, "0x3"), round: "3" },
        { ...record(4, "0x4"), outcome: "refunded" },
        { ...record(5, "0x5"), txHash: 5 },
        good,
      ]),
    );
    expect(loadBuys("g", ME, store)).toEqual([good]);
    store.map.set("fomo3d:buys:g:0xab01", JSON.stringify({ not: "an array" }));
    expect(loadBuys("g", ME, store)).toEqual([]);
  });

  it("caps the list at 50 records, newest first, on save and on load", () => {
    const store = memoryStore();
    let list: BuyRecord[] = [];
    for (let at = 1; at <= 51; at++) list = saveBuy("g", ME, list, record(at, `0x${at}`), store);
    expect(list).toHaveLength(50);
    expect(list[0].at).toBe(51);
    expect(list[49].at).toBe(2);
    store.map.set("fomo3d:buys:g:0xab01", JSON.stringify(Array.from({ length: 60 }, (_, i) => record(100 - i, `0x${i}`))));
    expect(loadBuys("g", ME, store)).toHaveLength(50);
  });
});
