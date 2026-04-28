import { describe, it, expect, vi, beforeEach } from "vitest";
import { fbclidResyncPlugin } from "../lib/form-core/plugins/fbclidResync.js";
import { createForm } from "../lib/FormFactory.js";
import { all } from "../lib/form-core/validators/index.js";

// All tests use a synthetic getHref so we don't have to mutate window.location
// (jsdom restricts that and it bleeds across tests anyway).

describe("fbclidResyncPlugin: enrich shape", () => {
  it("no-op when URL has no fbclid (and zero delay)", async () => {
    const p = fbclidResyncPlugin({ getHref: () => "https://example.com/page" });
    const t0 = Date.now();
    const out = await p.enrich({ a: 1 });
    expect(Date.now() - t0).toBeLessThan(20);
    expect(out).toEqual({ a: 1 });
  });

  it("returns payload unchanged on bad URL", async () => {
    const p = fbclidResyncPlugin({ getHref: () => "not a url" });
    const out = await p.enrich({ a: 1 });
    expect(out).toEqual({ a: 1 });
  });

  it("resyncs immediately when _fbp cookie is already set", async () => {
    document.cookie = "_fbp=fb.1.999.444; path=/";
    const p = fbclidResyncPlugin({
      getHref: () => "https://example.com/page?fbclid=ORIGINAL&utm=x",
    });
    const t0 = Date.now();
    const out = await p.enrich({ a: 1 });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(out.a).toBe(1);
    const url = new URL(out.landingPage);
    expect(url.searchParams.get("fbclid")).toBe("fb.1.999.444");
    expect(url.searchParams.get("utm")).toBe("x");
  });

  it("writes to a custom field when configured", async () => {
    document.cookie = "_fbp=fb.value; path=/";
    const p = fbclidResyncPlugin({
      field: "lp",
      getHref: () => "https://example.com/?fbclid=A",
    });
    const out = await p.enrich({});
    expect(out.lp).toContain("fbclid=fb.value");
    expect(out.landingPage).toBeUndefined();
  });

  it("retries until cookie appears, then resyncs", async () => {
    // Ensure no leftover cookie
    document.cookie = "_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";

    const p = fbclidResyncPlugin({
      getHref: () => "https://example.com/?fbclid=OLD",
      pollIntervalMs: 20,
      maxWaitMs: 500,
    });

    setTimeout(() => { document.cookie = "_fbp=fb.late; path=/"; }, 60);

    const t0 = Date.now();
    const out = await p.enrich({});
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(300);
    expect(out.landingPage).toContain("fbclid=fb.late");
  });

  it("times out without resync when cookie never appears", async () => {
    document.cookie = "_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    const p = fbclidResyncPlugin({
      getHref: () => "https://example.com/?fbclid=KEEP",
      pollIntervalMs: 20,
      maxWaitMs: 80,
    });
    const t0 = Date.now();
    const out = await p.enrich({ a: 1 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(out).toEqual({ a: 1 }); // no landingPage written
  });

  it("respects custom urlParam and cookieName", async () => {
    document.cookie = "myFbp=cookie.val; path=/";
    const p = fbclidResyncPlugin({
      urlParam: "click_id",
      cookieName: "myFbp",
      getHref: () => "https://example.com/?click_id=A&other=keep",
    });
    const out = await p.enrich({});
    const url = new URL(out.landingPage);
    expect(url.searchParams.get("click_id")).toBe("cookie.val");
    expect(url.searchParams.get("other")).toBe("keep");
  });
});

describe("controller enrich() lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const setup = (plugins, transport) => {
    document.body.innerHTML = `
      <form data-form="e1" novalidate>
        <input name="a" />
        <button type="submit">Go</button>
      </form>`;
    return createForm({
      id: "e1",
      transport,
      plugins,
      fields: { a: { get: () => document.querySelector('[name="a"]').value, validate: all() } },
    });
  };

  const submit = () => {
    document.querySelector('[data-form="e1"]').dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true })
    );
  };

  it("enriches in registration order (later plugin sees earlier output)", async () => {
    const seen = [];
    const t = { send: vi.fn(async (p) => { seen.push(p); return { success: true }; }) };
    const plugins = [
      { enrich: async (p) => ({ ...p, step1: true }) },
      { enrich: async (p) => {
          expect(p.step1).toBe(true);
          return { ...p, step2: true };
        } },
    ];
    const handle = setup(plugins, t);
    await handle.ready;
    submit();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0]).toMatchObject({ step1: true, step2: true });
  });

  it("returning null/undefined from enrich is a no-op (payload unchanged)", async () => {
    const seen = [];
    const t = { send: vi.fn(async (p) => { seen.push(p); return {}; }) };
    const plugins = [
      { enrich: async (p) => ({ ...p, set: 1 }) },
      { enrich: async () => null },
      { enrich: async () => undefined },
    ];
    const handle = setup(plugins, t);
    await handle.ready;
    submit();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0].set).toBe(1);
  });

  it("a throwing enrich is caught and the pipeline continues", async () => {
    const seen = [];
    const t = { send: vi.fn(async (p) => { seen.push(p); return {}; }) };
    const plugins = [
      { enrich: async () => { throw new Error("boom"); } },
      { enrich: async (p) => ({ ...p, after: true }) },
    ];
    const handle = setup(plugins, t);
    await handle.ready;
    submit();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0].after).toBe(true);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("fbclidResyncPlugin runs in the enrich phase end-to-end", async () => {
    document.cookie = "_fbp=fb.from-cookie; path=/";
    const seen = [];
    const t = { send: vi.fn(async (p) => { seen.push(p); return {}; }) };
    const handle = setup(
      [fbclidResyncPlugin({ getHref: () => "https://example.com/?fbclid=OLD" })],
      t
    );
    await handle.ready;
    submit();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0].landingPage).toContain("fbclid=fb.from-cookie");
  });
});
