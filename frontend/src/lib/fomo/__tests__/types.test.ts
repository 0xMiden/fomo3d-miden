import { describe, expect, it } from "vitest";
import { MAX_NOTE_AMOUNT, formatUsdc, noteAmountFits, parseUsdc } from "../types";

describe("USDCx formatting", () => {
  it("formats base units with two decimals by default", () => {
    expect(formatUsdc(1_000_000n)).toBe("1.00");
    expect(formatUsdc(1_234_567n)).toBe("1.23");
    expect(formatUsdc(0n)).toBe("0.00");
    expect(formatUsdc(100_000_000n, 0)).toBe("100");
    expect(formatUsdc(1_234_567n, 6)).toBe("1.234567");
  });

  it("parses typed amounts into base units and rejects junk", () => {
    expect(parseUsdc("1")).toBe(1_000_000n);
    expect(parseUsdc("1.1")).toBe(1_100_000n);
    expect(parseUsdc(" 0.000001 ")).toBe(1n);
    expect(parseUsdc("1.2345678")).toBeNull();
    expect(parseUsdc("abc")).toBeNull();
    expect(parseUsdc("")).toBeNull();
    expect(parseUsdc("-1")).toBeNull();
  });

  it("bounds a note amount to what the game's u32 arithmetic accepts", () => {
    expect(MAX_NOTE_AMOUNT).toBe(4_294_967_295n);
    expect(noteAmountFits(0n)).toBe(true);
    expect(noteAmountFits(4_294_967_295n)).toBe(true);
    expect(noteAmountFits(4_294_967_296n)).toBe(false);
    expect(noteAmountFits(-1n)).toBe(false);
  });
});
