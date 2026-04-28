import { describe, it, expect } from "vitest";
import { formatPhoneUS, formatZipUS, stripDashes } from "../lib/form-core/formatters/index.js";

describe("formatPhoneUS", () => {
  it("returns digits only when fewer than 4", () => {
    expect(formatPhoneUS("")).toBe("");
    expect(formatPhoneUS("21")).toBe("21");
    expect(formatPhoneUS("212")).toBe("212");
  });

  it("formats 4-6 digits as ###-###", () => {
    expect(formatPhoneUS("2125")).toBe("212-5");
    expect(formatPhoneUS("212555")).toBe("212-555");
  });

  it("formats 7-10 digits as ###-###-####", () => {
    expect(formatPhoneUS("2125550")).toBe("212-555-0");
    expect(formatPhoneUS("2125550100")).toBe("212-555-0100");
  });

  it("strips non-digits and caps at 10 digits", () => {
    expect(formatPhoneUS("(212) 555-0100 x999")).toBe("212-555-0100");
    expect(formatPhoneUS("21255501009999")).toBe("212-555-0100");
  });

  it("handles non-string inputs", () => {
    expect(formatPhoneUS(null)).toBe("");
    expect(formatPhoneUS(undefined)).toBe("");
    expect(formatPhoneUS(2125550100)).toBe("212-555-0100");
  });
});

describe("formatZipUS", () => {
  it("strips non-digits", () => {
    expect(formatZipUS("12345")).toBe("12345");
    expect(formatZipUS("12345-6789")).toBe("12345");
    expect(formatZipUS("a1b2c3d4e5")).toBe("12345");
  });
  it("caps at 5 digits", () => {
    expect(formatZipUS("123456789")).toBe("12345");
  });
  it("handles non-string inputs", () => {
    expect(formatZipUS(null)).toBe("");
    expect(formatZipUS(12345)).toBe("12345");
  });
});

describe("stripDashes", () => {
  it("removes only dashes", () => {
    expect(stripDashes("212-555-0100")).toBe("2125550100");
    expect(stripDashes("212 555-0100")).toBe("212 5550100");
    expect(stripDashes("")).toBe("");
  });
});
