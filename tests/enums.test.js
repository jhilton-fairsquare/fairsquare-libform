import { describe, it, expect } from "vitest";
import {
  ANNUAL_REVENUE_RANGES, ENTITY_TYPES, INDUSTRIES, CREDIT_RATINGS,
  TIER_TO_REVENUE_RANGE, groupTier, oneOf,
} from "../lib/form-core/enums.js";

describe("API enums (frozen)", () => {
  it.each([
    ["ANNUAL_REVENUE_RANGES", ANNUAL_REVENUE_RANGES, "Under $120K"],
    ["ENTITY_TYPES", ENTITY_TYPES, "LLC"],
    ["INDUSTRIES", INDUSTRIES, "Construction"],
    ["CREDIT_RATINGS", CREDIT_RATINGS, "Good"],
  ])("%s contains %s", (_name, list, member) => {
    expect(list).toContain(member);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it("ANNUAL_REVENUE_RANGES has all 5 NF tiers in order", () => {
    expect(ANNUAL_REVENUE_RANGES).toEqual([
      "Under $120K", "$120K-$249K", "$250K-$499K", "$500K-$999K", "Over $1M",
    ]);
  });
});

describe("TIER_TO_REVENUE_RANGE", () => {
  it("maps every tier code to a known enum value", () => {
    for (const [code, range] of Object.entries(TIER_TO_REVENUE_RANGE)) {
      expect(ANNUAL_REVENUE_RANGES).toContain(range);
      expect(code).toMatch(/^Tier \d[ab]?$/);
    }
  });

  it("matches the prod tier table exactly", () => {
    expect(TIER_TO_REVENUE_RANGE).toEqual({
      "Tier 1a": "Under $120K",
      "Tier 1b": "$120K-$249K",
      "Tier 2a": "$250K-$499K",
      "Tier 2b": "$500K-$999K",
      "Tier 3":  "Over $1M",
    });
  });
});

describe("groupTier", () => {
  it.each([
    ["Tier 1a", "Tier 1"],
    ["Tier 1b", "Tier 1"],
    ["Tier 2a", "Tier 2"],
    ["Tier 2b", "Tier 2"],
    ["Tier 3",  "Tier 3"],
  ])("groupTier(%s) = %s", (input, expected) => {
    expect(groupTier(input)).toBe(expected);
  });

  it("handles empty / non-string", () => {
    expect(groupTier("")).toBe("");
    expect(groupTier(undefined)).toBe("");
    expect(groupTier(null)).toBe("");
  });
});

describe("oneOf", () => {
  it("accepts allowed values", async () => {
    const v = oneOf(ANNUAL_REVENUE_RANGES);
    expect((await v("Under $120K")).valid).toBe(true);
    expect((await v("Over $1M")).valid).toBe(true);
  });
  it("rejects unknown values with allowed list in message", async () => {
    const v = oneOf(["a", "b"]);
    const r = await v("c");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/a, b/);
  });
  it("uses custom message", async () => {
    const v = oneOf(["a"], "Pick a");
    expect((await v("b")).message).toBe("Pick a");
  });
});
