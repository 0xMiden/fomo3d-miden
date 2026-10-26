import { describe, expect, it } from "vitest";
import { blockReason, SANCTIONED, STRICT } from "../../../../geoblock";

describe("blockReason", () => {
  it("refuses sanctioned and strictly regulated countries, in any case", () => {
    expect(blockReason("IR")).toBe("sanctioned");
    expect(blockReason("us")).toBe("restricted");
    expect(blockReason("DE")).toBe("restricted");
  });
  it("welcomes everyone else, including unknown locations", () => {
    expect(blockReason("AR")).toBeNull();
    expect(blockReason("")).toBeNull();
    expect(blockReason(null)).toBeNull();
    expect(blockReason(undefined)).toBeNull();
  });
  it("keeps the two lists disjoint", () => {
    for (const code of SANCTIONED) expect(STRICT.has(code)).toBe(false);
  });
});
