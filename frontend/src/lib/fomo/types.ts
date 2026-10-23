/** Round state read from the game account's public storage. */
export type GameState = {
  pot: bigint;
  price: bigint;
  /** Unix seconds (block timestamp) after which settle is allowed. */
  deadline: number;
  keys: bigint;
  /** Account id felts of the sender of the last accepted buy; null while the round has no key. */
  leader: { suffix: bigint; prefix: bigint } | null;
  /** Price increase per accepted key, base units. */
  priceStep: bigint;
  /** Seconds each accepted key adds to the deadline. */
  extendSeconds: number;
  /** The deadline never exceeds block time plus this many seconds. */
  capSeconds: number;
  /** Pot ceiling, base units. */
  maxPot: bigint;
  /** Length of a fresh round in seconds; settle sets the next deadline to block time plus this. */
  roundSeconds: number;
  /** Key price a fresh round opens with, base units. */
  startPrice: bigint;
  /** Round counter; settle increments it. */
  round: number;
};

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
