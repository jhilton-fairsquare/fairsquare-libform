import { describe, it, expect } from "vitest";
import {
  required, email, emailStrict,
  phoneBasic, phoneDashedUS, phoneUS,
  zipUS,
  lettersHyphenSpaces, fullName, fullNameLettersOnly,
  minLength, maxLength, pattern,
  requiredSelect, mustAccept, usState,
  all, any,
  __testing,
} from "../lib/form-core/validators/index.js";

const expectValid = async (v, value) => {
  const r = await v(value);
  expect(r.valid, `expected ${JSON.stringify(value)} to be valid; got: ${r.message}`).toBe(true);
};
const expectInvalid = async (v, value, msgFragment) => {
  const r = await v(value);
  expect(r.valid, `expected ${JSON.stringify(value)} to be invalid`).toBe(false);
  if (msgFragment) expect(r.message).toMatch(msgFragment);
};

describe("required", () => {
  const v = required();
  it.each(["", "   ", null, undefined])("rejects %j", async (val) => expectInvalid(v, val));
  it.each(["a", "  a  ", "0"])("accepts %j", async (val) => expectValid(v, val));
});

describe("emailStrict", () => {
  const v = emailStrict();
  it.each([
    "ada@example.com",
    "a.b+c@sub.example.co",
    "user@example.museum",
  ])("accepts %j", async (val) => expectValid(v, val));

  it.each([
    "",
    "no-at-sign",
    "double..dot@example.com",
    "trailing@dot.com.",
    "duplabel@example.com.com",
    "no-tld@example",
    "spaces in@example.com",
  ])("rejects %j", async (val) => expectInvalid(v, val));
});

describe("phoneUS", () => {
  const v = phoneUS();
  it.each([
    "212-555-0100",
    "212 555 0100",
    "2125550100",
    "  212-555-0100  ",
  ])("accepts %j", async (val) => expectValid(v, val));

  it.each([
    "112-555-0100", // leading 1 area code
    "012-555-0100", // leading 0 area code
    "12-555-0100",  // too short
    "21255501000",  // too long
    "abcd",
    "",
  ])("rejects %j", async (val) => expectInvalid(v, val));
});

describe("phoneDashedUS", () => {
  const v = phoneDashedUS();
  it("accepts properly dashed", async () => expectValid(v, "123-456-7890"));
  it("rejects spaces", async () => expectInvalid(v, "123 456 7890"));
  it("rejects raw digits", async () => expectInvalid(v, "1234567890"));
});

describe("zipUS", () => {
  const v = zipUS();
  it.each(["12345", "00501", "99950", "10001"])(
    "accepts %j", async (val) => expectValid(v, val)
  );
  it("rejects all zeros", async () => expectInvalid(v, "00000", /zeros/i));
  it("rejects below range (00500)", async () => expectInvalid(v, "00500"));
  it("rejects above range (99951)", async () => expectInvalid(v, "99951"));
  it("rejects non-5-digit", async () => expectInvalid(v, "1234"));
  it("rejects letters", async () => expectInvalid(v, "1234A"));
  it("accepts and slices ZIP+4 prefix", async () => expectValid(v, "12345-6789"));
});

describe("lettersHyphenSpaces", () => {
  const v = lettersHyphenSpaces();
  it.each([
    "Ada",
    "Mary Jane",
    "Anne-Marie",
    "Anne-Marie Jones",
  ])("accepts %j", async (val) => expectValid(v, val));

  it.each([
    "Ada123",
    "Ada!",
    "  ",
    "",
    "-Ada",
    "Ada-",
    " Ada Lovelace ", // trailing+leading spaces are trimmed by toStr
  ])("evaluates %j", async (val) => {
    if (val.trim() === "Ada Lovelace") return expectValid(v, val);
    return expectInvalid(v, val);
  });
});

describe("fullNameLettersOnly", () => {
  const v = fullNameLettersOnly();
  it("accepts two-word name", async () => expectValid(v, "Ada Lovelace"));
  it("accepts three-word name", async () => expectValid(v, "Ada Augusta King"));
  it("rejects single word", async () => expectInvalid(v, "Ada"));
  it("rejects digits", async () => expectInvalid(v, "Ada Lovelace 2"));
  it("rejects empty", async () => expectInvalid(v, ""));
});

describe("fullName (loose)", () => {
  const v = fullName();
  it("accepts hyphenated name", async () => expectValid(v, "Ada Lovelace-King"));
});

describe("mustAccept", () => {
  const v = mustAccept();
  it.each([true, "true", "on", "1", "yes"])("accepts %j", async (val) => expectValid(v, val));
  it.each([false, "false", "off", "", null])("rejects %j", async (val) => expectInvalid(v, val));
});

describe("requiredSelect", () => {
  const v = requiredSelect();
  it("accepts non-empty", async () => expectValid(v, "Tier 1a"));
  it("rejects empty", async () => expectInvalid(v, ""));
});

describe("usState", () => {
  const v = usState();
  it.each(["CA", "ca", " ca ", "TX", "DC"])("accepts valid US state %j", async (val) => expectValid(v, val));
  it.each(["", "C", "CAL", "ZZ", "California", "12"])("rejects %j", async (val) => expectInvalid(v, val));
});

describe("minLength / maxLength / pattern", () => {
  it("minLength", async () => {
    const v = minLength(3);
    await expectInvalid(v, "ab");
    await expectValid(v, "abc");
  });
  it("maxLength", async () => {
    const v = maxLength(3);
    await expectValid(v, "abc");
    await expectInvalid(v, "abcd");
  });
  it("pattern", async () => {
    const v = pattern(/^foo/);
    await expectValid(v, "foobar");
    await expectInvalid(v, "barfoo");
  });
});

describe("all / any composition", () => {
  it("all returns first failure", async () => {
    const v = all(required("R"), emailStrict("E"));
    expect((await v("")).message).toBe("R");
    expect((await v("not-email")).message).toBe("E");
    expect((await v("ada@example.com")).valid).toBe(true);
  });

  it("any returns ok if any pass", async () => {
    const v = any(emailStrict("E"), phoneUS("P"));
    expect((await v("ada@example.com")).valid).toBe(true);
    expect((await v("212-555-0100")).valid).toBe(true);
    expect((await v("nope")).valid).toBe(false);
  });
});

describe("toStr coercion", () => {
  it("handles dom-like and arrays", () => {
    expect(__testing.toStr({ value: 42 })).toBe("42");
    expect(__testing.toStr({ firstName: "Ada" })).toBe("Ada");
    expect(__testing.toStr(["a", "b"])).toBe("a,b");
    expect(__testing.toStr(null)).toBe("");
  });
});

describe("email (loose)", () => {
  it("accepts a basic email", async () => expectValid(email(), "ada@example.com"));
  it("rejects bare string", async () => expectInvalid(email(), "ada"));
});

describe("phoneBasic", () => {
  it("accepts +1 (212) 555-0100", async () => expectValid(phoneBasic(), "+1 (212) 555-0100"));
  it("rejects letters", async () => expectInvalid(phoneBasic(), "abc"));
});
