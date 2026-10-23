import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ buildNetworkNote: vi.fn() }));

vi.mock("@/lib/fomo/bread", () => ({
  customTransaction: () => ({}),
  explorer: { tx: (h: string) => `/t/${h}`, note: (h: string) => `/n/${h}` },
  parseAccountId: (h: string) => ({ toString: () => h }),
  shortHex: (h: string) => h,
}));
vi.mock("@/lib/fomo/notes", () => ({ buildNetworkNote: sdk.buildNetworkNote }));
vi.mock("@/lib/fomo/scripts", () => ({ loadScript: async () => ({}) }));
vi.mock("@/lib/fomo/requests", () => ({ ownOutputRequest: () => ({}) }));
vi.mock("@/lib/fomo/faucet", () => ({ requestFaucetTokens: vi.fn() }));
vi.mock("@/lib/fomo/game", () => ({
  holdsLeader: (state: { leader: string | null }, account: string) => state.leader === account,
  roundPhase: () => "open",
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
});
