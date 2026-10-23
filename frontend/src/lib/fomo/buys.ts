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
};

export interface BuyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (game: string) => `fomo3d:buys:${game.toLowerCase()}`;

/** Identity of a record: the moment it was sent plus its note id. */
export const buyKey = (record: Pick<BuyRecord, "at" | "noteId">) => `${record.at}:${record.noteId ?? ""}`;

const defaultStore = (): BuyStore | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function loadBuys(game: string, store: BuyStore | null = defaultStore()): BuyRecord[] {
  try {
    const raw = store?.getItem(storageKey(game));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as BuyRecord[]) : [];
  } catch {
    return [];
  }
}

function writeBuys(game: string, buys: BuyRecord[], store: BuyStore | null) {
  try {
    store?.setItem(storageKey(game), JSON.stringify(buys));
  } catch {
    // Private windows and blocked storage: the list is then only as long as this page's life.
  }
}

/** Persists a buy BEFORE the wallet is asked to send it, newest first. */
export function saveBuy(game: string, record: BuyRecord, store: BuyStore | null = defaultStore()): BuyRecord[] {
  const buys = [record, ...loadBuys(game, store).filter((b) => buyKey(b) !== buyKey(record))];
  writeBuys(game, buys, store);
  return buys;
}

export function updateBuy(
  game: string,
  key: Pick<BuyRecord, "at" | "noteId">,
  patch: Partial<BuyRecord>,
  store: BuyStore | null = defaultStore(),
): BuyRecord[] {
  const buys = loadBuys(game, store).map((b) => (buyKey(b) === buyKey(key) ? { ...b, ...patch } : b));
  writeBuys(game, buys, store);
  return buys;
}
