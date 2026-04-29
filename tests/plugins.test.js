import { describe, it, expect, vi } from "vitest";
import { redirectOnUrlPlugin } from "../lib/form-core/plugins/redirectOnUrl.js";
import { serverValidationPlugin } from "../lib/form-core/plugins/serverValidation.js";
import { tierMapPlugin } from "../lib/form-core/plugins/tierMap.js";
import { queryParamsPlugin } from "../lib/form-core/plugins/queryParams.js";
import { attributionPlugin } from "../lib/form-core/plugins/attribution.js";
import { staticFieldsPlugin } from "../lib/form-core/plugins/staticFields.js";
import { TransportError } from "../lib/form-core/adapters/transport.js";

const fakeCtx = (overrides = {}) => ({
  id: "form-1",
  formSelector: '[data-form="form-1"]',
  setFieldErrors: vi.fn(),
  ...overrides,
});

describe("redirectOnUrlPlugin", () => {
  it("redirects on 200 with res.url", () => {
    const navigate = vi.fn();
    const p = redirectOnUrlPlugin({ navigate });
    p.onSuccess({ success: true, url: "https://nf.example/apply?x=1" }, fakeCtx());
    expect(navigate).toHaveBeenCalledWith("https://nf.example/apply?x=1");
  });

  it("does not redirect on 200 without url", () => {
    const navigate = vi.fn();
    redirectOnUrlPlugin({ navigate }).onSuccess({ success: true }, fakeCtx());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects on 500 with err.url", () => {
    const navigate = vi.fn();
    const err = new TransportError({ status: 500, body: { url: "https://nf.example/fb" }, url: "https://nf.example/fb" });
    redirectOnUrlPlugin({ navigate }).onError(err, fakeCtx());
    expect(navigate).toHaveBeenCalledWith("https://nf.example/fb");
  });

  it("redirects on 400 missingFields with url", () => {
    const navigate = vi.fn();
    const err = new TransportError({
      status: 400,
      body: { missingFields: ["consent"], url: "https://nf.example/fb" },
      url: "https://nf.example/fb",
    });
    redirectOnUrlPlugin({ navigate }).onError(err, fakeCtx());
    expect(navigate).toHaveBeenCalledWith("https://nf.example/fb");
  });

  it("does NOT redirect on 400 fields[] by default (keeps user on form)", () => {
    const navigate = vi.fn();
    const err = new TransportError({
      status: 400,
      body: { fields: ["email"], url: "https://nf.example/fb" },
      url: "https://nf.example/fb",
    });
    redirectOnUrlPlugin({ navigate }).onError(err, fakeCtx());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does redirect on 400 fields[] when onValidationError: true", () => {
    const navigate = vi.fn();
    const err = new TransportError({
      status: 400,
      body: { fields: ["email"], url: "https://nf.example/fb" },
      url: "https://nf.example/fb",
    });
    redirectOnUrlPlugin({ navigate, onValidationError: true }).onError(err, fakeCtx());
    expect(navigate).toHaveBeenCalledWith("https://nf.example/fb");
  });

  it("ignores non-http urls (no javascript: redirects)", () => {
    const navigate = vi.fn();
    redirectOnUrlPlugin({ navigate }).onSuccess({ url: "javascript:alert(1)" }, fakeCtx());
    redirectOnUrlPlugin({ navigate }).onSuccess({ url: "/relative" }, fakeCtx());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("transformUrl rewrites before navigating", () => {
    const navigate = vi.fn();
    const p = redirectOnUrlPlugin({
      navigate,
      transformUrl: (u) => `${u}&utm=appended`,
    });
    p.onSuccess({ url: "https://nf.example/apply?x=1" }, fakeCtx());
    expect(navigate).toHaveBeenCalledWith("https://nf.example/apply?x=1&utm=appended");
  });

  it("transformUrl returning a non-http value blocks navigation", () => {
    const navigate = vi.fn();
    const p = redirectOnUrlPlugin({ navigate, transformUrl: () => "evil:" });
    p.onSuccess({ url: "https://nf.example/apply" }, fakeCtx());
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("serverValidationPlugin", () => {
  it("calls setFieldErrors with mapped messages", () => {
    const ctx = fakeCtx();
    const err = new TransportError({ status: 400, body: { fields: ["email", "phone"] } });
    serverValidationPlugin().onError(err, ctx);
    expect(ctx.setFieldErrors).toHaveBeenCalledTimes(1);
    const arg = ctx.setFieldErrors.mock.calls[0][0];
    expect(arg.email).toMatch(/email/i);
    expect(arg.phone).toMatch(/phone/i);
  });

  it("respects fieldNameMap (API → form name)", () => {
    const ctx = fakeCtx();
    const err = new TransportError({ status: 400, body: { fields: ["zipCode"] } });
    serverValidationPlugin({ fieldNameMap: { zipCode: "businessZipcode" } }).onError(err, ctx);
    const arg = ctx.setFieldErrors.mock.calls[0][0];
    expect(arg.businessZipcode).toBeDefined();
    expect(arg.zipCode).toBeUndefined();
  });

  it("uses custom messages over defaults", () => {
    const ctx = fakeCtx();
    const err = new TransportError({ status: 400, body: { fields: ["email"] } });
    serverValidationPlugin({ messages: { email: "Bad email!" } }).onError(err, ctx);
    expect(ctx.setFieldErrors.mock.calls[0][0].email).toBe("Bad email!");
  });

  it("does nothing when body lacks fields[]", () => {
    const ctx = fakeCtx();
    const err = new TransportError({ status: 500, body: { message: "boom" } });
    serverValidationPlugin().onError(err, ctx);
    expect(ctx.setFieldErrors).not.toHaveBeenCalled();
  });

  it("uses fallbackMessage for unknown fields", () => {
    const ctx = fakeCtx();
    const err = new TransportError({ status: 400, body: { fields: ["customField"] } });
    serverValidationPlugin({ fallbackMessage: "Bad" }).onError(err, ctx);
    expect(ctx.setFieldErrors.mock.calls[0][0].customField).toBe("Bad");
  });
});

describe("tierMapPlugin", () => {
  describe("input convention 1: form value is the API enum directly", () => {
    it("passes the enum through verbatim as annualRevenueRange", () => {
      const ctx = { onSubmit: (v) => ({ ...v }) };
      tierMapPlugin().init(ctx);
      const out = ctx.onSubmit({ salesDistributionTier: "$500K-$999K", other: "x" });
      expect(out.annualRevenueRange).toBe("$500K-$999K");
      expect(out.other).toBe("x");
    });

    it("works for every documented enum value", () => {
      const ctx = { onSubmit: null };
      tierMapPlugin().init(ctx);
      for (const range of ["Under $120K", "$120K-$249K", "$250K-$499K", "$500K-$999K", "Over $1M"]) {
        const out = ctx.onSubmit({ salesDistributionTier: range });
        expect(out.annualRevenueRange).toBe(range);
      }
    });

    it("with tierField opt-in, reverse-derives the grouped tier code", () => {
      const ctx = { onSubmit: null };
      tierMapPlugin({ tierField: "salesDistributionTier" }).init(ctx);
      const out = ctx.onSubmit({ salesDistributionTier: "$500K-$999K" });
      expect(out.salesDistributionTier).toBe("Tier 2"); // grouped from "Tier 2b"
      expect(out.annualRevenueRange).toBe("$500K-$999K");
    });
  });

  describe("input convention 2: form value is a legacy Tier code", () => {
    it("emits annualRevenueRange by default; salesDistributionTier is NOT shipped (not in API spec)", () => {
      const ctx = { onSubmit: (v) => ({ ...v }) };
      tierMapPlugin().init(ctx);
      const out = ctx.onSubmit({ salesDistributionTier: "Tier 2a", other: "x" });
      expect(out.annualRevenueRange).toBe("$250K-$499K");
      expect(out.salesDistributionTier).toBe("Tier 2a"); // unchanged passthrough; tierMap did not overwrite
      expect(out.other).toBe("x");
    });

    it("legacy parity: opt-in tierField restores grouped tier output", () => {
      const ctx = { onSubmit: null };
      tierMapPlugin({ tierField: "salesDistributionTier" }).init(ctx);
      const out = ctx.onSubmit({ salesDistributionTier: "Tier 2a" });
      expect(out.salesDistributionTier).toBe("Tier 2");
      expect(out.annualRevenueRange).toBe("$250K-$499K");
    });

    it("emits raw (ungrouped) tier when group: false and tierField is set", () => {
      const ctx = { onSubmit: null };
      tierMapPlugin({ tierField: "salesDistributionTier", group: false }).init(ctx);
      const out = ctx.onSubmit({ salesDistributionTier: "Tier 2a" });
      expect(out.salesDistributionTier).toBe("Tier 2a");
      expect(out.annualRevenueRange).toBe("$250K-$499K");
    });
  });

  describe("malformed input", () => {
    it("does nothing when source field is empty", () => {
      const ctx = { onSubmit: null };
      tierMapPlugin().init(ctx);
      const out = ctx.onSubmit({ salesDistributionTier: "" });
      expect(out.annualRevenueRange).toBeUndefined();
    });

    it("does NOT emit when value matches neither enum nor tier code", () => {
      const ctx = { onSubmit: null };
      tierMapPlugin().init(ctx);
      const out = ctx.onSubmit({ salesDistributionTier: "approximately $500k" });
      expect(out.annualRevenueRange).toBeUndefined();
    });
  });

  it("preserves existing onSubmit (composes)", () => {
    const ctx = { onSubmit: (v) => ({ ...v, source: "NF" }) };
    tierMapPlugin().init(ctx);
    const out = ctx.onSubmit({ salesDistributionTier: "Tier 3" });
    expect(out.source).toBe("NF");
    expect(out.annualRevenueRange).toBe("Over $1M");
  });
});

describe("queryParamsPlugin", () => {
  const setSearch = (s) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: s, href: "https://example.com/" + s },
    });
  };

  it("captures default canonical fields from URL → camelCase keys", () => {
    setSearch("?utm_source=google&utm_medium=cpc&gclid=abc&fbclid=xyz");
    const ctx = { onSubmit: null };
    queryParamsPlugin().init(ctx);
    const out = ctx.onSubmit({});
    expect(out.utmSource).toBe("google");
    expect(out.utmMedium).toBe("cpc");
    expect(out.gclid).toBe("abc");
    expect(out.fbclid).toBe("xyz");
  });

  it("ignores params not in the map", () => {
    setSearch("?random=x");
    const ctx = { onSubmit: null };
    queryParamsPlugin().init(ctx);
    expect(ctx.onSubmit({}).random).toBeUndefined();
  });

  it("namespace option nests under a key", () => {
    setSearch("?utm_source=google");
    const ctx = { onSubmit: null };
    queryParamsPlugin({ namespace: "attribution" }).init(ctx);
    const out = ctx.onSubmit({});
    expect(out.attribution).toEqual({ utmSource: "google" });
  });

  it("custom map replaces defaults", () => {
    setSearch("?p=abc&utm_source=google");
    const ctx = { onSubmit: null };
    queryParamsPlugin({ map: { p: "partnerCode" } }).init(ctx);
    const out = ctx.onSubmit({});
    expect(out.partnerCode).toBe("abc");
    expect(out.utmSource).toBeUndefined();
  });

  it("does not capture gclsrc by default (not in API spec)", () => {
    setSearch("?gclid=abc&gclsrc=aw.ds");
    const ctx = { onSubmit: null };
    queryParamsPlugin().init(ctx);
    const out = ctx.onSubmit({});
    expect(out.gclid).toBe("abc");
    expect(out.gclsrc).toBeUndefined();
  });

  it("gclsrc can be opted in via extraMap", () => {
    setSearch("?gclid=abc&gclsrc=aw.ds");
    const ctx = { onSubmit: null };
    queryParamsPlugin({ extraMap: { gclsrc: "gclsrc" } }).init(ctx);
    const out = ctx.onSubmit({});
    expect(out.gclsrc).toBe("aw.ds");
  });
});

describe("staticFieldsPlugin", () => {
  it("merges statics into payload via enrich (override default)", async () => {
    const p = staticFieldsPlugin({
      source: "NF",
      formType: "DLPv2-2step",
      journey: "NFCoreApply",
      responseChannel: "Internet",
    });
    const out = await p.enrich({ email: "a@b.com" });
    expect(out).toMatchObject({
      email: "a@b.com",
      source: "NF",
      formType: "DLPv2-2step",
      journey: "NFCoreApply",
      responseChannel: "Internet",
    });
  });

  it("override mode beats existing keys (statics are authoritative)", async () => {
    const p = staticFieldsPlugin({ formType: "OVERRIDE" });
    const out = await p.enrich({ formType: "wrong", other: 1 });
    expect(out.formType).toBe("OVERRIDE");
    expect(out.other).toBe(1);
  });

  it("fill mode preserves existing keys, only fills empty/missing", async () => {
    const p = staticFieldsPlugin(
      { formType: "FROM_STATIC", journey: "NFCoreApply", source: "NF" },
      { mode: "fill" }
    );
    const out = await p.enrich({ formType: "from_consumer", source: "" });
    expect(out.formType).toBe("from_consumer");   // existing kept
    expect(out.journey).toBe("NFCoreApply");      // missing filled
    expect(out.source).toBe("NF");                // empty string filled
  });

  it("strips null/undefined entries (won't blank out a real value)", async () => {
    const p = staticFieldsPlugin({
      formType: "Real",
      journey: undefined,
      source: null,
    });
    const out = await p.enrich({ journey: "Existing", source: "Existing" });
    expect(out.formType).toBe("Real");
    expect(out.journey).toBe("Existing");
    expect(out.source).toBe("Existing");
  });

  it("handles empty config gracefully", async () => {
    const p = staticFieldsPlugin();
    const out = await p.enrich({ a: 1 });
    expect(out).toEqual({ a: 1 });
  });
});

describe("attributionPlugin", () => {
  const setSearch = (s) => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: s, href: "https://example.com/page?" + s.replace(/^\?/, "") },
    });
  };

  it("emits spec-documented attribution fields by default (no nfid, no path)", () => {
    setSearch("?ref=email");
    const ctx = { onSubmit: null };
    attributionPlugin().init(ctx);
    const out = ctx.onSubmit({});
    expect(out.landingPage).toContain("example.com/page");
    expect(out.clientBrowser).toBeTypeOf("string");
    expect("referrer" in out).toBe(true);
    expect(out.nfid).toBeUndefined(); // legacy; opt-in via includeNfid: true
    expect(out.path).toBeUndefined(); // legacy; opt-in via includePath: true
  });

  it("includeNfid + includePath restore the legacy fields when explicitly opted in", () => {
    setSearch("?ref=email");
    const ctx = { onSubmit: null };
    attributionPlugin({ includeNfid: true, includePath: true }).init(ctx);
    const out = ctx.onSubmit({});
    expect(out.nfid).toMatch(/^NFID-/);
    expect(out.path).not.toContain("?");
  });

  it("still sets ctx.clientId so downstream plugins can read NFID even without emitting it", () => {
    const ctx = { onSubmit: null };
    attributionPlugin().init(ctx);
    expect(ctx.clientId).toMatch(/^NFID-/);
  });

  it("includeTrackingId reads _ga cookie when present", () => {
    document.cookie = "_ga=GA1.2.1234567890.1234567890; path=/";
    const ctx = { onSubmit: null };
    attributionPlugin().init(ctx);
    const out = ctx.onSubmit({});
    expect(out.trackingId).toBe("GA1.2.1234567890.1234567890");
  });

  it("respects include* flags", () => {
    const ctx = { onSubmit: null };
    attributionPlugin({
      includeReferrer: false,
      includeLandingPage: false,
      includeClientBrowser: false,
      includeTrackingId: false,
    }).init(ctx);
    const out = ctx.onSubmit({});
    expect(Object.keys(out).length).toBe(0);
  });

  it("renames keys via fields option (when emission is opted in)", () => {
    const ctx = { onSubmit: null };
    attributionPlugin({ includeNfid: true, fields: { nfid: "client_id" } }).init(ctx);
    const out = ctx.onSubmit({});
    expect(out.client_id).toBeDefined();
    expect(out.nfid).toBeUndefined();
  });
});
