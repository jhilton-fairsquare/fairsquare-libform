import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dataLayerPlugin, sources, resolveSource } from "../lib/form-core/plugins/dataLayer.js";
import { redirectOnUrlPlugin } from "../lib/form-core/plugins/redirectOnUrl.js";
import { createForm } from "../lib/FormFactory.js";
import { all } from "../lib/form-core/validators/index.js";

beforeEach(() => {
  document.body.innerHTML = "";
  delete window.dataLayer;
  delete window.gtag;
});
afterEach(() => {
  delete window.dataLayer;
  delete window.gtag;
});

describe("resolveSource", () => {
  const ctx = { formSelector: '[data-form="t"]' };

  it("string shorthand → static", () => {
    expect(resolveSource("hello", ctx, {}, null)).toBe("hello");
  });

  it("function shorthand receives (values, response, ctx)", () => {
    expect(
      resolveSource(
        (v, r, c) => `${v.a}-${r?.b}-${c.formSelector}`,
        ctx, { a: "x" }, { b: "y" }
      )
    ).toBe('x-y-[data-form="t"]');
  });

  it("static source with default fallback", () => {
    expect(resolveSource(sources.static("v"), ctx, {}, null)).toBe("v");
    expect(resolveSource({ source: "static", default: "d" }, ctx, {}, null)).toBe("d");
  });

  it("form source returns the field value", () => {
    expect(resolveSource(sources.form("zip"), ctx, { zip: "12345" }, null)).toBe("12345");
  });

  it("form source falls back to default when missing/empty", () => {
    expect(resolveSource(sources.form("zip", { default: "" }), ctx, {}, null)).toBe("");
    expect(resolveSource(sources.form("zip", { default: "00000" }), ctx, { zip: "" }, null)).toBe("00000");
  });

  it("form source with as:'label' reads <option>.text from a select", () => {
    document.body.innerHTML = `
      <form data-form="t">
        <select name="tier">
          <option value="">--</option>
          <option value="Tier 2a">$250K-$499K</option>
        </select>
      </form>`;
    const select = document.querySelector('[name="tier"]');
    select.value = "Tier 2a";
    expect(resolveSource(sources.form("tier", { as: "label" }), ctx, { tier: "Tier 2a" }, null))
      .toBe("$250K-$499K");
  });

  it("response source resolves a dotted path", () => {
    const r = { state: "CA", deeply: { nested: { event_card: "card numbers submitted" } } };
    expect(resolveSource(sources.response("state"), ctx, {}, r)).toBe("CA");
    expect(resolveSource(sources.response("deeply.nested.event_card"), ctx, {}, r))
      .toBe("card numbers submitted");
  });

  it("response source falls back to default when missing", () => {
    expect(resolveSource(sources.response("missing", { default: "—" }), ctx, {}, {})).toBe("—");
    expect(resolveSource(sources.response("any", { default: "x" }), ctx, {}, null)).toBe("x");
  });

  it("function throwing returns empty string", () => {
    expect(resolveSource(() => { throw new Error("boom"); }, ctx, {}, null)).toBe("");
  });
});

describe("dataLayerPlugin: payload shape", () => {
  it("builds the spec payload from static + form + response sources", async () => {
    document.body.innerHTML = `
      <form data-form="t">
        <select name="ags">
          <option value="">--</option>
          <option value="Tier 2a">$250K-$499K</option>
        </select>
      </form>`;
    document.querySelector('[name="ags"]').value = "Tier 2a";

    const ctx = {
      formSelector: '[data-form="t"]',
      getValues: () => ({ ags: "Tier 2a", zipCode: "12345" }),
    };

    const plugin = dataLayerPlugin({
      form_type: "large_stand_alone_apply_now",
      params: {
        event_tier: { source: "form", name: "ags" },
        tierDetail: { source: "form", name: "ags", as: "label" },
        zip_code:   { source: "form", name: "zipCode", default: "" },
        event_card: { source: "response", path: "event_card", default: "no card submitted" },
        state:      { source: "response", path: "state", default: "" },
      },
      reliability: "none",
    });

    await plugin.onSuccess({ event_card: "card numbers submitted", state: "CA" }, ctx);

    expect(window.dataLayer).toHaveLength(1);
    expect(window.dataLayer[0]).toEqual({
      event: "gaEvent",
      eventCategory: "forms",
      eventAction: "submission",
      form_type: "large_stand_alone_apply_now",
      event_tier: "Tier 2a",
      tierDetail: "$250K-$499K",
      zip_code: "12345",
      event_card: "card numbers submitted",
      state: "CA",
    });
  });

  it("falls back to defaults when response missing", async () => {
    const ctx = { formSelector: '[data-form="t"]', getValues: () => ({}) };
    const plugin = dataLayerPlugin({
      form_type: "x",
      params: {
        event_card: { source: "response", path: "event_card", default: "no card submitted" },
        state:      { source: "response", path: "state", default: "" },
        zip_code:   { source: "form", name: "zip", default: "" },
      },
      reliability: "none",
    });
    await plugin.onSuccess({}, ctx);
    expect(window.dataLayer[0]).toMatchObject({
      event_card: "no card submitted",
      state: "",
      zip_code: "",
    });
  });
});

describe("dataLayerPlugin: fireOn modes", () => {
  const fakeCtx = () => ({
    formSelector: '[data-form="t"]',
    getValues: () => ({ a: 1 }),
  });

  it("default fireOn:'success' wires only onSuccess", () => {
    const p = dataLayerPlugin({ form_type: "x" });
    expect(typeof p.onSuccess).toBe("function");
    expect(p.onBeforeSend).toBeUndefined();
  });

  it("fireOn:'submit' wires only onBeforeSend", () => {
    const p = dataLayerPlugin({ form_type: "x", fireOn: "submit" });
    expect(typeof p.onBeforeSend).toBe("function");
    expect(p.onSuccess).toBeUndefined();
  });

  it("fireOn:'both' wires both", () => {
    const p = dataLayerPlugin({ form_type: "x", fireOn: "both" });
    expect(typeof p.onBeforeSend).toBe("function");
    expect(typeof p.onSuccess).toBe("function");
  });

  it("alsoFireOnError fires gaEventError with errorStatus/errorMessage", async () => {
    const p = dataLayerPlugin({ form_type: "x", reliability: "none" });
    await p.onError(
      { status: 500, message: "boom", body: { state: "CA" } },
      fakeCtx()
    );
    expect(window.dataLayer[0]).toMatchObject({
      event: "gaEventError",
      errorStatus: 500,
      errorMessage: "boom",
    });
  });

  it("alsoFireOnError:false skips error fires", () => {
    const p = dataLayerPlugin({ form_type: "x", alsoFireOnError: false });
    expect(p.onError).toBeUndefined();
  });
});

describe("dataLayerPlugin: reliability strategies", () => {
  const ctx = { formSelector: '[data-form="t"]', getValues: () => ({}) };

  it("'none' resolves immediately", async () => {
    const p = dataLayerPlugin({ form_type: "x", reliability: "none" });
    const t0 = performance.now();
    await p.onSuccess({}, ctx);
    expect(performance.now() - t0).toBeLessThan(10);
    expect(window.dataLayer).toHaveLength(1);
  });

  it("'microtask' drains microtasks but stays sub-perceptible", async () => {
    const p = dataLayerPlugin({ form_type: "x", reliability: "microtask" });
    const t0 = performance.now();
    await p.onSuccess({}, ctx);
    expect(performance.now() - t0).toBeLessThan(20);
    expect(window.dataLayer).toHaveLength(1);
  });

  it("'eventCallback' uses gtag and resolves on callback", async () => {
    const calls = [];
    window.gtag = vi.fn((...args) => {
      calls.push(args);
      const cfg = args[2];
      // Simulate gtag firing the callback after a short delay
      setTimeout(() => cfg.event_callback?.(), 5);
    });
    const p = dataLayerPlugin({ form_type: "x", reliability: "eventCallback", reliabilityTimeoutMs: 500 });
    const t0 = performance.now();
    await p.onSuccess({}, ctx);
    const elapsed = performance.now() - t0;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("event");
    expect(calls[0][1]).toBe("gaEvent");
    expect(calls[0][2]).toMatchObject({ event_timeout: 500 });
    expect(elapsed).toBeLessThan(500); // resolved before the timeout
  });

  it("'eventCallback' timeout caps wait when callback never fires", async () => {
    window.gtag = vi.fn(); // no-op: callback never fires
    const p = dataLayerPlugin({
      form_type: "x", reliability: "eventCallback", reliabilityTimeoutMs: 30,
    });
    const t0 = performance.now();
    await p.onSuccess({}, ctx);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(120);
  });

  it("'auto' picks eventCallback when gtag exists, microtask otherwise", async () => {
    // No gtag: should not call window.gtag, should still push and resolve quickly
    const p1 = dataLayerPlugin({ form_type: "x", reliability: "auto" });
    await p1.onSuccess({}, ctx);
    expect(window.dataLayer).toHaveLength(1);

    // With gtag stub: should call gtag
    window.gtag = vi.fn((..._args) => { _args[2].event_callback?.(); });
    const p2 = dataLayerPlugin({ form_type: "x", reliability: "auto" });
    await p2.onSuccess({}, ctx);
    expect(window.gtag).toHaveBeenCalled();
  });
});

describe("dataLayerPlugin: ordering with redirect", () => {
  it("redirect waits for dataLayer push when registered first", async () => {
    document.body.innerHTML = `
      <form data-form="ord" novalidate>
        <input name="email" />
        <button type="submit">Go</button>
      </form>`;
    const fillThenSubmit = () => {
      document.querySelector('[name="email"]').value = "a@b.com";
      document.querySelector('[data-form="ord"]').dispatchEvent(
        new Event("submit", { cancelable: true, bubbles: true })
      );
    };

    const events = [];
    const navigate = vi.fn((url) => events.push(`nav:${url}`));

    const fakeTransport = {
      send: async () => ({ success: true, url: "https://nf.example/apply" }),
    };

    const handle = createForm({
      id: "ord",
      transport: fakeTransport,
      fields: { email: { get: () => document.querySelector('[name="email"]').value, validate: all() } },
      plugins: [
        dataLayerPlugin({
          form_type: "ordering-test",
          reliability: "delay",       // 30ms
          reliabilityTimeoutMs: 30,
          params: { tag: "ok" },
          // After the dataLayer push completes, record the order
          // (We piggyback by mutating events on push)
        }),
        // Capture the "after dataLayer" moment
        { onSuccess: () => events.push("dl-done") },
        redirectOnUrlPlugin({ navigate }),
      ],
    });
    await handle.ready;

    fillThenSubmit();
    await new Promise((r) => setTimeout(r, 100));

    // dataLayer push happened at least once
    expect(window.dataLayer?.length).toBeGreaterThanOrEqual(1);
    // Order check: dl-done before nav
    const dlIdx = events.indexOf("dl-done");
    const navIdx = events.findIndex((e) => e.startsWith("nav:"));
    expect(dlIdx).toBeGreaterThanOrEqual(0);
    expect(navIdx).toBeGreaterThan(dlIdx);
  });
});
