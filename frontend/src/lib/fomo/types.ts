/** Round state read from the game account's public storage. */
export type GameState = {
  pot: bigint;
  price: bigint;
  /** Unix seconds (block timestamp) after which settle is allowed. */
  deadline: number;
  keys: bigint;
  settled: boolean;
  /** Hex of the leading secret commitment word, as `Word.toHex()` prints it. */
  leader: string;
  /** Price increase per accepted key, base units. */
  priceStep: bigint;
  /** Seconds each accepted key adds to the deadline. */
  extendSeconds: number;
  /** The deadline never exceeds block time plus this many seconds. */
  capSeconds: number;
  /** Pot ceiling, base units. */
  maxPot: bigint;
};

/** The leader slot of a round with no keys. */
export const EMPTY_LEADER = "0x0000000000000000000000000000000000000000000000000000000000000000";

export const USDCX_DECIMALS = 6;

export const formatUsdc = (units: bigint, digits = 2) => {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, digits);
  return `${sign}${whole}${digits > 0 ? `.${frac}` : ""}`;
};

/** Parses a USDCx amount typed by a person ("1.25") into base units. Returns null when invalid. */
export const parseUsdc = (text: string): bigint | null => {
  const match = /^\s*(\d+)(?:\.(\d{0,6}))?\s*$/.exec(text);
  if (!match) return null;
  const [, whole, frac = ""] = match;
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
};
