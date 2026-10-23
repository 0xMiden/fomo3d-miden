import type { AccountId, Word } from "@miden-sdk/miden-sdk";
import { EMPTY_LEADER, type GameState } from "./types";

/** The slice of the SDK client the game reader needs; narrow so tests can fake it. */
export interface GameReader {
  getAccount(id: AccountId): Promise<{ storage(): { getItem(name: string): Word | undefined } } | undefined>;
  importAccountById(id: AccountId): Promise<void>;
  syncState(): Promise<unknown>;
}

const ROUND = "fomo3d::game::round";
const LEADER = "fomo3d::game::leader";
const CONFIG = "fomo3d::game::config";
const STATUS = "fomo3d::game::status";

const u64s = (word: Word | undefined) => word?.toFelts().map((felt) => felt.asInt());

/** Decodes the five public storage slots into a `GameState`. */
export function decodeGameStorage(storage: { getItem(name: string): Word | undefined }): GameState {
  const round = u64s(storage.getItem(ROUND));
  const config = u64s(storage.getItem(CONFIG));
  const status = u64s(storage.getItem(STATUS));
  const leader = storage.getItem(LEADER)?.toHex() ?? EMPTY_LEADER;
  if (!round || round.length < 4) throw new Error("Game storage is missing the round slot.");
  if (!config || config.length < 4) throw new Error("Game storage is missing the config slot.");
  return {
    pot: round[0],
    price: round[1],
    deadline: Number(round[2]),
    keys: round[3],
    settled: (status?.[0] ?? 0n) === 1n,
    leader,
    priceStep: config[0],
    extendSeconds: Number(config[1]),
    capSeconds: Number(config[2]),
    maxPot: config[3],
  };
}

/** Imports the public game account on first use, syncs, and decodes its storage. */
export async function readGameState(client: GameReader, gameId: AccountId): Promise<GameState> {
  if (!(await client.getAccount(gameId))) await client.importAccountById(gameId);
  await client.syncState();
  const account = await client.getAccount(gameId);
  if (!account) throw new Error("Game account is not available on this network.");
  return decodeGameStorage(account.storage());
}

/** Whether `commitments` (hex words) contain the current on-chain leader. */
export const holdsLeader = (state: GameState, commitments: string[]) =>
  state.leader !== EMPTY_LEADER && commitments.some((c) => c.toLowerCase() === state.leader.toLowerCase());

export type RoundPhase = "open" | "expired" | "settled";

/** `now` is wall clock seconds; block timestamps lag it slightly, so "expired" may flip a little late on chain. */
export const roundPhase = (state: GameState, now: number): RoundPhase =>
  state.settled ? "settled" : now > state.deadline ? "expired" : "open";

/** The deadline a buy accepted at block time `at` would produce. */
export const nextDeadline = (state: GameState, at: number) =>
  Math.min(state.deadline + state.extendSeconds, at + state.capSeconds);
