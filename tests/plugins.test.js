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
  it("translates tier code → grouped tier + annualRevenueRange", () => {
    const ctx = { onSubmit: null };
    tierMapPlugin().init(ctx);
    const out = ctx.onSubmit({ salesDistributionTier: "Tier 2a", other: "x" });
    expect(out.salesDistributionTier).toBe("Tier 2");
    expect(out.annualRevenueRange).toBe("$250K-$499K");
    expect(out.other).toBe("x");
  });

  it("emits raw tier when group: false", () => {
    const ctx = { onSubmit: null };
    tierMapPlugin({ group: false }).init(ctx);
    const out = ctx.onSubmit({ salesDistributionTier: "Tier 2a" });
    expect(out.salesDistributionTier).toBe("Tier 2a");
    expect(out.annualRevenueRange).toBe("$250K-$499K");
  });

  it("does nothing when source field is empty", () => {
    const ctx = { onSubmit: null };
    tierMapPlugin().init(ctx);
    const out = ctx.onSubmit({ salesDistributionTier: "" });
    expect(out.salesDistributionTier).toBeFalsy();
    expect(out.annualRevenueRange).toBeUndefined();
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

  it("captures gclsrc alongside gclid", () => {
    setSearch("?gclid=abc&gclsrc=aw.ds");
    const ctx = { onSubmit: null };
    queryParamsPlugin().init(ctx);
    const out = ctx.onSubmit({});
    expect(out.gclid).toBe("abc");
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

  it("emits NFID, landingPage, path, referrer, clientBrowser", () => {
    setSearch("?ref=email");
    const ctx = { onSubmit: null };
    attributionPlugin().init(ctx);
    const out = ctx.onSubmit({});
    expect(out.nfid).toMatch(/^NFID-/);
    expect(out.landingPage).toContain("example.com/page");
    expect(out.path).not.toContain("?");
    expect(out.clientBrowser).toBeTypeOf("string");
    expect("referrer" in out).toBe(true);
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
      includePath: false,
      includeClientBrowser: false,
      includeTrackingId: false,
    }).init(ctx);
    const out = ctx.onSubmit({});
    expect(Object.keys(out).filter((k) => k !== "nfid").length).toBe(0);
  });

  it("renames keys via fields option", () => {
    const ctx = { onSubmit: null };
    attributionPlugin({ fields: { nfid: "client_id" } }).init(ctx);
    const out = ctx.onSubmit({});
    expect(out.client_id).toBeDefined();
    expect(out.nfid).toBeUndefined();
  });
});
