import { AccountId, type Word } from "@miden-sdk/miden-sdk";
import type { GameState } from "./types";

/** The slice of the SDK client the game reader needs; narrow so tests can fake it. */
export interface GameReader {
  getAccount(id: AccountId): Promise<{ storage(): { getItem(name: string): Word | undefined } } | undefined>;
  importAccountById(id: AccountId): Promise<void>;
  syncState(): Promise<unknown>;
}

const ROUND = "fomo3d::game::round";
const LEADER = "fomo3d::game::leader";
const CONFIG = "fomo3d::game::config";
const WINDOW = "fomo3d::game::window";

const u64s = (word: Word | undefined) => word?.toFelts().map((felt) => felt.asInt());

/** Decodes the public storage slots into a `GameState`. */
export function decodeGameStorage(storage: { getItem(name: string): Word | undefined }): GameState {
  const round = u64s(storage.getItem(ROUND));
  const config = u64s(storage.getItem(CONFIG));
  const window = u64s(storage.getItem(WINDOW));
  const leader = u64s(storage.getItem(LEADER));
  if (!round || round.length < 4) throw new Error("Game storage is missing the round slot.");
  if (!config || config.length < 4) throw new Error("Game storage is missing the config slot.");
  if (!window || window.length < 3) throw new Error("Game storage is missing the window slot.");
  return {
    pot: round[0],
    price: round[1],
    deadline: Number(round[2]),
    keys: round[3],
    // The slot is all zero until a buy is accepted in this round.
    leader: leader && (leader[0] !== 0n || leader[1] !== 0n) ? { suffix: leader[0], prefix: leader[1] } : null,
    priceStep: config[0],
    extendSeconds: Number(config[1]),
    capSeconds: Number(config[2]),
    maxPot: config[3],
    roundSeconds: Number(window[0]),
    startPrice: window[1],
    round: Number(window[2]),
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

/**
 * Whether the account with hex id `accountHex` sent the last accepted buy. Every SDK call mints
 * a fresh `AccountId`: handles are passed by value and a second use throws.
 */
export const holdsLeader = (state: GameState, accountHex: string | null | undefined): boolean =>
  !!state.leader &&
  !!accountHex &&
  AccountId.fromHex(accountHex).prefix().asInt() === state.leader.prefix &&
  AccountId.fromHex(accountHex).suffix().asInt() === state.leader.suffix;

export type RoundPhase = "open" | "expired";

/** `now` is wall clock seconds; block timestamps lag it slightly, so "expired" may flip a little late on chain. */
export const roundPhase = (state: GameState, now: number): RoundPhase => (now > state.deadline ? "expired" : "open");

/** The deadline a buy accepted at block time `at` would produce. */
export const nextDeadline = (state: GameState, at: number) =>
  Math.min(state.deadline + state.extendSeconds, at + state.capSeconds);
