import { describe, expect, it } from "vitest";
import type { Word } from "@miden-sdk/miden-sdk";
import { decodeGameStorage, holdsLeader, nextDeadline, readGameState, roundPhase } from "../game";
import { EMPTY_LEADER } from "../types";

const word = (values: bigint[], hex = "0xword") =>
  ({ toFelts: () => values.map((value) => ({ asInt: () => value })), toHex: () => hex }) as unknown as Word;

const storage = (slots: Record<string, Word | undefined>) => ({ getItem: (name: string) => slots[name] });

const liveSlots = {
  "fomo3d::game::round": word([2_100_000n, 1_200_000n, 1_800_000_000n, 2n]),
  "fomo3d::game::leader": word([1n, 2n, 3n, 4n], "0xleader"),
  "fomo3d::game::config": word([100_000n, 60n, 600n, 1_000_000_000n]),
  "fomo3d::game::status": word([0n, 0n, 0n, 0n]),
};

describe("decodeGameStorage", () => {
  it("reads round, config and status slots", () => {
    const state = decodeGameStorage(storage(liveSlots));
    expect(state).toEqual({
      pot: 2_100_000n,
      price: 1_200_000n,
      deadline: 1_800_000_000,
      keys: 2n,
      settled: false,
      leader: "0xleader",
      priceStep: 100_000n,
      extendSeconds: 60,
      capSeconds: 600,
      maxPot: 1_000_000_000n,
    });
  });

  it("marks a settled round and falls back to the empty leader", () => {
    const state = decodeGameStorage(
      storage({ ...liveSlots, "fomo3d::game::leader": undefined, "fomo3d::game::status": word([1n, 0n, 0n, 0n]) }),
    );
    expect(state.settled).toBe(true);
    expect(state.leader).toBe(EMPTY_LEADER);
  });

  it("rejects storage without the round slot", () => {
    expect(() => decodeGameStorage(storage({}))).toThrow(/round slot/);
  });
});

describe("readGameState", () => {
  it("imports the account once, syncs, then decodes", async () => {
    const calls: string[] = [];
    let imported = false;
    const client = {
      getAccount: async () => {
        calls.push("get");
        return imported ? { storage: () => storage(liveSlots) } : undefined;
      },
      importAccountById: async () => {
        calls.push("import");
        imported = true;
      },
      syncState: async () => calls.push("sync"),
    };
    const state = await readGameState(client, {} as never);
    expect(state.keys).toBe(2n);
    expect(calls).toEqual(["get", "import", "sync", "get"]);
  });
});

describe("round helpers", () => {
  const state = decodeGameStorage(storage(liveSlots));

  it("detects when one of my commitments leads", () => {
    expect(holdsLeader(state, ["0xother", "0xLEADER"])).toBe(true);
    expect(holdsLeader(state, ["0xother"])).toBe(false);
    expect(holdsLeader({ ...state, leader: EMPTY_LEADER }, [EMPTY_LEADER])).toBe(false);
  });

  it("derives the phase from the clock and the status", () => {
    expect(roundPhase(state, 1_799_999_999)).toBe("open");
    expect(roundPhase(state, 1_800_000_001)).toBe("expired");
    expect(roundPhase({ ...state, settled: true }, 0)).toBe("settled");
  });

  it("caps the extension at block time plus the cap", () => {
    expect(nextDeadline(state, 1_799_000_000)).toBe(1_799_000_600);
    expect(nextDeadline(state, 1_800_000_000)).toBe(1_800_000_060);
  });
});
