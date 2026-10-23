import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ buildNetworkNote: vi.fn(), roundPhase: vi.fn(() => "open"), faucet: vi.fn() }));

vi.mock("@/lib/fomo/bread", () => ({
  customTransaction: () => ({}),
  explorer: { tx: (h: string) => `/t/${h}`, note: (h: string) => `/n/${h}` },
  parseAccountId: (h: string) => ({ toString: () => h }),
  shortHex: (h: string) => h,
}));
vi.mock("@/lib/fomo/notes", () => ({ buildNetworkNote: sdk.buildNetworkNote }));
vi.mock("@/lib/fomo/scripts", () => ({ loadScript: async () => ({}) }));
vi.mock("@/lib/fomo/requests", () => ({ ownOutputRequest: () => ({}) }));
vi.mock("@/lib/fomo/faucet", () => ({ requestFaucetTokens: sdk.faucet }));
vi.mock("@/lib/fomo/game", () => ({
  holdsLeader: (state: { leader: string | null }, account: string) => state.leader === account,
  roundPhase: sdk.roundPhase,
}));

import { loadBuys } from "@/lib/fomo/buys";
import type { GameState } from "@/lib/fomo/types";
import { useFomoActions } from "../useFomoActions";

const GAME = "0xgame";
const ME = "0xme";
const state = (over: Partial<GameState & { leader: unknown }> = {}) =>
  ({
    pot: 0n,
    price: 1_000_000n,
    deadline: 2_000_000_000,
    keys: 2n,
    leader: null,
    priceStep: 100_000n,
    extendSeconds: 60,
    capSeconds: 600,
    maxPot: 1_000_000_000n,
    roundSeconds: 900,
    startPrice: 1_000_000n,
    round: 4,
    ...over,
  }) as unknown as GameState;
const snapshot = (s: GameState) => ({ state: s, feeFaucet: "0xfee", syncHeight: 1 });

const bread = (over: Record<string, unknown> = {}) =>
  ({
    connected: true,
    address: "mtst1abc",
    accountHex: ME,
    requestTransaction: vi.fn(async () => "w1"),
    waitForTransaction: vi.fn(async () => ({ txHash: "0xtx" })),
    requestAssets: vi.fn(async () => []),
    ...over,
  }) as never;

const setup = (b = bread(), refresh = vi.fn(async () => null as ReturnType<typeof snapshot> | null)) =>
  renderHook(() => useFomoActions({ gameHex: GAME, snapshot: snapshot(state()), refresh, bread: b }));

beforeEach(() => {
  localStorage.clear();
  sdk.roundPhase.mockReset();
  sdk.roundPhase.mockReturnValue("open");
  sdk.faucet.mockReset();
  sdk.buildNetworkNote.mockReset();
  sdk.buildNetworkNote.mockReturnValue({ id: () => ({ toString: () => "0xnote" }) });
});
afterEach(() => vi.useRealTimers());

describe("useFomoActions buy", () => {
  it("forgets the pre-saved record when Bread rejects the request", async () => {
    const { result } = setup(bread({ requestTransaction: vi.fn(async () => Promise.reject(new Error("rejected"))) }));
    await act(async () => void (await result.current.buy(1_000_000n)));
    expect(result.current.buys).toEqual([]);
    expect(loadBuys(GAME, ME)).toEqual([]);
    expect(result.current.log[0]).toMatchObject({ kind: "error", text: "rejected" });
  });

  it("keeps the record, with its wallet id, when only the wait for submission fails", async () => {
    const { result } = setup(bread({ waitForTransaction: vi.fn(async () => Promise.reject(new Error("timed out"))) }));
    await act(async () => void (await result.current.buy(1_000_000n)));
    expect(result.current.buys).toHaveLength(1);
    expect(result.current.buys[0]).toMatchObject({ noteId: "0xnote", walletTxId: "w1" });
    expect(result.current.buys[0].outcome).toBeUndefined();
    expect(loadBuys(GAME, ME)).toHaveLength(1);
  });

  it("refuses a spend that does not fit in a u32 before building the note", async () => {
    const { result } = setup(bread(), vi.fn(async () => snapshot(state({ round: 5, keys: 0n }))));
    await act(async () => void (await result.current.buy(4_294_967_296n)));
    expect(sdk.buildNetworkNote).not.toHaveBeenCalled();
    expect(result.current.buys).toEqual([]);
    expect(result.current.log[0]).toMatchObject({ kind: "error" });
    expect(result.current.log[0].text).toMatch(/u32/);
    await act(async () => void (await result.current.buy(4_294_967_295n)));
    expect(sdk.buildNetworkNote).toHaveBeenCalledTimes(1);
  });

  it("records led when this account leads after a key was accepted", async () => {
    const refresh = vi.fn(async () => snapshot(state({ keys: 3n, leader: ME as never })));
    const { result } = setup(bread(), refresh);
    await act(async () => void (await result.current.buy(1_000_000n)));
    expect(result.current.buys[0]).toMatchObject({ txHash: "0xtx", outcome: "led" });
    expect(loadBuys(GAME, ME)[0].outcome).toBe("led");
  });

  it("records ended when the round moved on", async () => {
    const refresh = vi.fn(async () => snapshot(state({ round: 5, keys: 0n })));
    const { result } = setup(bread(), refresh);
    await act(async () => void (await result.current.buy(1_000_000n)));
    expect(result.current.buys[0].outcome).toBe("ended");
  });

  it("does not take another player's key for its own outcome, and ends unconfirmed", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => snapshot(state({ keys: 3n, leader: "0xother" as never })));
    const { result } = setup(bread(), refresh);
    await act(async () => {
      const done = result.current.buy(1_000_000n);
      await vi.advanceTimersByTimeAsync(200_000);
      await done;
    });
    expect(result.current.buys[0]).toMatchObject({ txHash: "0xtx", outcome: "unconfirmed" });
    expect(result.current.busy).toBeNull();
  });

  it("keeps writing an in-flight buy to the account that sent it after the Bread account changes", async () => {
    let approve!: (id: string) => void;
    const request = vi.fn(() => new Promise<string>((resolve) => (approve = resolve)));
    const refresh = vi.fn(async () => snapshot(state({ round: 5, keys: 0n })));
    const { result, rerender } = renderHook(
      ({ b }: { b: never }) => useFomoActions({ gameHex: GAME, snapshot: snapshot(state()), refresh, bread: b }),
      { initialProps: { b: bread({ requestTransaction: request }) } },
    );
    let done!: Promise<unknown>;
    await act(async () => {
      done = result.current.buy(1_000_000n);
    });
    expect(loadBuys(GAME, ME)).toHaveLength(1);
    rerender({ b: bread({ accountHex: "0xother", requestTransaction: request }) });
    expect(result.current.buys).toEqual([]);
    await act(async () => {
      approve("w1");
      await done;
    });
    const mine = loadBuys(GAME, ME);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ noteId: "0xnote", walletTxId: "w1", txHash: "0xtx", outcome: "ended" });
    expect(loadBuys(GAME, "0xother")).toEqual([]);
    expect(result.current.buys).toEqual([]);
  });

  it("drops a rejected in-flight buy from the sending account's history, not the active one's", async () => {
    let reject!: (error: Error) => void;
    const request = vi.fn(() => new Promise<string>((_, fail) => (reject = fail)));
    const { result, rerender } = renderHook(
      ({ b }: { b: never }) => useFomoActions({ gameHex: GAME, snapshot: snapshot(state()), refresh: vi.fn(async () => null), bread: b }),
      { initialProps: { b: bread({ requestTransaction: request }) } },
    );
    let done!: Promise<unknown>;
    await act(async () => {
      done = result.current.buy(1_000_000n);
    });
    rerender({ b: bread({ accountHex: "0xother", requestTransaction: request }) });
    await act(async () => {
      reject(new Error("rejected"));
      await done;
    });
    expect(loadBuys(GAME, ME)).toEqual([]);
  });

  it("persists an in-flight buy even when the component unmounts before the wallet answers", async () => {
    let approve!: (id: string) => void;
    const request = vi.fn(() => new Promise<string>((resolve) => (approve = resolve)));
    const refresh = vi.fn(async () => snapshot(state({ round: 5, keys: 0n })));
    const { result, unmount } = setup(bread({ requestTransaction: request }), refresh);
    let done!: Promise<unknown>;
    await act(async () => {
      done = result.current.buy(1_000_000n);
    });
    unmount();
    approve("w1");
    await done;
    expect(loadBuys(GAME, ME)[0]).toMatchObject({ noteId: "0xnote", walletTxId: "w1", txHash: "0xtx", outcome: "ended" });
  });

  it("refuses to buy once the clock ran out", async () => {
    sdk.roundPhase.mockReturnValue("expired");
    const { result } = setup();
    await act(async () => void (await result.current.buy(1_000_000n)));
    expect(sdk.buildNetworkNote).not.toHaveBeenCalled();
    expect(result.current.log[0].text).toMatch(/Time is up/);
  });
});

describe("useFomoActions settle and faucet", () => {
  it("refuses to settle while the clock is still running", async () => {
    const { result } = setup();
    await act(async () => void (await result.current.settle()));
    expect(sdk.buildNetworkNote).not.toHaveBeenCalled();
    expect(result.current.log[0]).toMatchObject({ kind: "error", text: "The clock has not run out yet." });
  });

  it("settles an expired round and waits for the round to advance", async () => {
    sdk.roundPhase.mockReturnValue("expired");
    const b = bread();
    const refresh = vi.fn(async () => snapshot(state({ round: 5, keys: 0n })));
    const { result } = setup(b, refresh);
    await act(async () => void (await result.current.settle()));
    expect(sdk.buildNetworkNote).toHaveBeenCalledTimes(1);
    expect(result.current.log.map((entry) => entry.text).join("\n")).toMatch(/Round 4 settled/);
    expect(result.current.busy).toBeNull();
  });

  it("logs the faucet note it requested for the connected account", async () => {
    sdk.faucet.mockResolvedValue({ noteId: "0xfaucetnote", amount: 100_000_000n, faucetWalletId: "f" });
    const { result } = setup();
    await act(async () => void (await result.current.faucet()));
    expect(sdk.faucet).toHaveBeenCalledWith(ME, expect.anything());
    expect(result.current.log[0]).toMatchObject({ kind: "ok", href: "/n/0xfaucetnote" });
  });
});
