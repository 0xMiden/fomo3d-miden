import { describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-sdk", () => import("@/__tests__/mocks/miden-sdk"));

import type { Word } from "@miden-sdk/miden-sdk";
import { decodeGameStorage, holdsLeader, nextDeadline, readGameState, roundPhase } from "../game";

const word = (values: bigint[]) => ({ toFelts: () => values.map((value) => ({ asInt: () => value })) }) as unknown as Word;

const storage = (slots: Record<string, Word | undefined>) => ({ getItem: (name: string) => slots[name] });

/** `0x` + 30 hex digits; the mock splits it into an 8-byte prefix and a 7-byte suffix. */
const LEADER_HEX = `0x${"ab".repeat(15)}`;
const LEADER_PREFIX = BigInt(`0x${"ab".repeat(8)}`);
const LEADER_SUFFIX = BigInt(`0x${"ab".repeat(7)}`);

const liveSlots = {
  "fomo3d::game::round": word([2_100_000n, 1_200_000n, 1_800_000_000n, 2n]),
  "fomo3d::game::leader": word([LEADER_SUFFIX, LEADER_PREFIX, 0n, 0n]),
  "fomo3d::game::config": word([100_000n, 60n, 600n, 1_000_000_000n]),
  "fomo3d::game::window": word([900n, 1_000_000n, 7n, 0n]),
};

describe("decodeGameStorage", () => {
  it("reads the round, leader, config and window slots", () => {
    const state = decodeGameStorage(storage(liveSlots));
    expect(state).toEqual({
      pot: 2_100_000n,
      price: 1_200_000n,
      deadline: 1_800_000_000,
      keys: 2n,
      leader: { suffix: LEADER_SUFFIX, prefix: LEADER_PREFIX },
      priceStep: 100_000n,
      extendSeconds: 60,
      capSeconds: 600,
      maxPot: 1_000_000_000n,
      roundSeconds: 900,
      startPrice: 1_000_000n,
      round: 7,
    });
  });

  it("reads an all-zero or missing leader slot as no leader", () => {
    expect(decodeGameStorage(storage({ ...liveSlots, "fomo3d::game::leader": word([0n, 0n, 0n, 0n]) })).leader).toBeNull();
    expect(decodeGameStorage(storage({ ...liveSlots, "fomo3d::game::leader": undefined })).leader).toBeNull();
  });

  it("rejects storage without the round or window slot", () => {
    expect(() => decodeGameStorage(storage({}))).toThrow(/round slot/);
    expect(() => decodeGameStorage(storage({ ...liveSlots, "fomo3d::game::window": undefined }))).toThrow(/window slot/);
  });
});

describe("readGameState", () => {
  it("imports the account once, syncs, then decodes", async () => {
    const calls: string[] = [];
    const handles: unknown[] = [];
    let imported = false;
    const client = {
      getAccount: async (id: unknown) => {
        handles.push(id);
        calls.push("get");
        return imported ? { storage: () => storage(liveSlots) } : undefined;
      },
      importAccountById: async (id: unknown) => {
        handles.push(id);
        calls.push("import");
        imported = true;
      },
      syncState: async () => calls.push("sync"),
    };
    const state = await readGameState(client, LEADER_HEX);
    expect(state.keys).toBe(2n);
    expect(calls).toEqual(["get", "import", "sync", "get"]);
    // The SDK consumes an AccountId passed by value, so every call needs its own.
    expect(handles).toHaveLength(3);
    expect(new Set(handles).size).toBe(3);
  });
});

describe("round helpers", () => {
  const state = decodeGameStorage(storage(liveSlots));

  it("detects when the connected account sent the last accepted buy", () => {
    expect(holdsLeader(state, LEADER_HEX)).toBe(true);
    expect(holdsLeader(state, `0x${"cd".repeat(15)}`)).toBe(false);
    expect(holdsLeader(state, null)).toBe(false);
    expect(holdsLeader({ ...state, leader: null }, LEADER_HEX)).toBe(false);
  });

  it("derives the phase from the clock alone", () => {
    expect(roundPhase(state, 1_799_999_999)).toBe("open");
    expect(roundPhase(state, 1_800_000_000)).toBe("open");
    expect(roundPhase(state, 1_800_000_001)).toBe("expired");
  });

  it("caps the extension at block time plus the cap", () => {
    expect(nextDeadline(state, 1_799_000_000)).toBe(1_799_000_600);
    expect(nextDeadline(state, 1_800_000_000)).toBe(1_800_000_060);
  });
});
