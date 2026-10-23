/**
 * Buy secrets live in this browser only. Losing one makes a winning prize unclaimable; anyone
 * who reads it can claim. That is the prototype's documented limit.
 */
export type KeyRecord = {
  /** Hex commitment word, as the game's leader slot prints it. */
  commitment: string;
  /** Four felts as decimal strings (JSON has no bigint). */
  secret: string[];
  /** Base64 of the serialized P2ID refund template note. */
  refundTemplate: string;
  /** Maximum spend locked into the buy note, base units. */
  maxSpend: string;
  /** Price shown when the buy was sent, base units. */
  priceAtBuy: string;
  /** Local client sync height when the buy was sent; refund recovery scans from here. */
  blockAtBuy?: number;
  /** Id of the buy note, read before it was handed to the wallet. */
  noteId?: string;
  /** Unix ms. */
  at: number;
  /** Bread's internal transaction id (what `requestTransaction` returns). */
  walletTxId?: string;
  /** On-chain transaction hash once Bread reports completion. */
  txHash?: string;
  /** Set once the prize was claimed with this secret by the browser's claimant wallet. */
  claimedTxHash?: string;
  /** Hex id of the claimant wallet that holds (or held) the prize. */
  claimant?: string;
  /** Set once the claimed pot was forwarded to the Bread account. */
  forwardedTxHash?: string;
  /** Set once a refund note for this key was consumed. */
  refundTxHash?: string;
};

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storageKey = (game: string) => `fomo3d:keys:${game.toLowerCase()}`;

const defaultStore = (): KeyStore | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function loadKeys(game: string, store: KeyStore | null = defaultStore()): KeyRecord[] {
  try {
    const raw = store?.getItem(storageKey(game));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as KeyRecord[]) : [];
  } catch {
    return [];
  }
}

function writeKeys(game: string, keys: KeyRecord[], store: KeyStore | null) {
  try {
    store?.setItem(storageKey(game), JSON.stringify(keys));
  } catch {
    // Private windows and blocked storage: the caller surfaces the secret on screen instead.
  }
}

/** Persists a new key BEFORE the wallet is asked to send it, newest first. */
export function saveKey(game: string, record: KeyRecord, store: KeyStore | null = defaultStore()): KeyRecord[] {
  const keys = [record, ...loadKeys(game, store).filter((k) => k.commitment !== record.commitment)];
  writeKeys(game, keys, store);
  return keys;
}

export function updateKey(
  game: string,
  commitment: string,
  patch: Partial<KeyRecord>,
  store: KeyStore | null = defaultStore(),
): KeyRecord[] {
  const keys = loadKeys(game, store).map((k) => (k.commitment === commitment ? { ...k, ...patch } : k));
  writeKeys(game, keys, store);
  return keys;
}

export const secretOf = (record: KeyRecord): bigint[] => record.secret.map((value) => BigInt(value));

export const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const base64ToBytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
