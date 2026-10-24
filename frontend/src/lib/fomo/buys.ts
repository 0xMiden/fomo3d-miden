/** A buy sent from this browser, remembered so the page can label it against the live round. */
export type BuyRecord = {
  /** Id of the buy note, read before it was handed to the wallet. */
  noteId?: string;
  /** Bread's internal transaction id (what `requestTransaction` returns). */
  walletTxId?: string;
  /** On-chain transaction hash once Bread reports completion. */
  txHash?: string;
  /** Maximum spend locked into the buy note, base units. */
  maxSpend: string;
  /** Price shown when the buy was sent, base units. */
  priceAtBuy: string;
  /** Round number shown when the buy was sent. */
  round: number;
  /** Unix ms. */
  at: number;
  /** What the buy flow observed once it stopped waiting; absent while in flight or after a reload mid-flow. */
  outcome?: BuyOutcome;
};

export type BuyOutcome = "led" | "ended" | "unconfirmed";

export interface BuyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Newest records kept per game and account. */
export const MAX_BUYS = 50;

const storageKey = (game: string, account: string) => `fomo3d:buys:${game.toLowerCase()}:${account.toLowerCase()}`;

/** Identity of a record: the moment it was sent plus its note id. */
export const buyKey = (record: Pick<BuyRecord, "at" | "noteId">) => `${record.at}:${record.noteId ?? ""}`;

const defaultStore = (): BuyStore | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const OUTCOMES: readonly string[] = ["led", "ended", "unconfirmed"];
const isDecimal = (value: unknown) => typeof value === "string" && /^\d+$/.test(value);
const isOptionalString = (value: unknown) => value === undefined || typeof value === "string";

/** Stored JSON is untrusted: another version or a hand edit can leave anything in the array. */
function isBuyRecord(value: unknown): value is BuyRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    isDecimal(r.maxSpend) &&
    isDecimal(r.priceAtBuy) &&
    Number.isFinite(r.round) &&
    Number.isFinite(r.at) &&
    isOptionalString(r.noteId) &&
    isOptionalString(r.walletTxId) &&
    isOptionalString(r.txHash) &&
    (r.outcome === undefined || OUTCOMES.includes(r.outcome as string))
  );
}

export function loadBuys(game: string, account: string, store: BuyStore | null = defaultStore()): BuyRecord[] {
  try {
    const raw = store?.getItem(storageKey(game, account));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isBuyRecord).slice(0, MAX_BUYS) : [];
  } catch {
    return [];
  }
}

/** Persists `buys` and returns it capped; the caller's list stays the truth when storage fails. */
function writeBuys(game: string, account: string, buys: BuyRecord[], store: BuyStore | null): BuyRecord[] {
  const kept = buys.slice(0, MAX_BUYS);
  try {
    store?.setItem(storageKey(game, account), JSON.stringify(kept));
  } catch {
    // Private windows and blocked storage: the list is then only as long as this page's life.
  }
  return kept;
}

/** Persists a buy BEFORE the wallet is asked to send it, newest first. `current` is the list the page holds. */
export function saveBuy(
  game: string,
  account: string,
  current: BuyRecord[],
  record: BuyRecord,
  store: BuyStore | null = defaultStore(),
): BuyRecord[] {
  return writeBuys(game, account, [record, ...current.filter((b) => buyKey(b) !== buyKey(record))], store);
}

export function updateBuy(
  game: string,
  account: string,
  current: BuyRecord[],
  key: Pick<BuyRecord, "at" | "noteId">,
  patch: Partial<BuyRecord>,
  store: BuyStore | null = defaultStore(),
): BuyRecord[] {
  return writeBuys(game, account, current.map((b) => (buyKey(b) === buyKey(key) ? { ...b, ...patch } : b)), store);
}

/** Drops one record, e.g. a buy Bread refused to send. */
export function forgetBuy(
  game: string,
  account: string,
  current: BuyRecord[],
  key: Pick<BuyRecord, "at" | "noteId">,
  store: BuyStore | null = defaultStore(),
): BuyRecord[] {
  return writeBuys(game, account, current.filter((b) => buyKey(b) !== buyKey(key)), store);
}

/**
 * The outcome of a buy from the game state read after Bread submitted it, or null while it
 * cannot be told. Another player's accepted key moves the shared state too, so a changed key
 * count counts only when this account is the leader; a refund changes nothing, so it never
 * resolves here.
 */
export const buyWaitOutcome = (
  roundBefore: number,
  keysBefore: bigint,
  round: number,
  keys: bigint,
  leading: boolean,
): BuyOutcome | null => (round > roundBefore ? "ended" : keys > keysBefore && leading ? "led" : null);
