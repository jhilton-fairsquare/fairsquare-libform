import { describe, it, expect, beforeEach } from "vitest";
import { waitForElement, mount } from "../lib/form-core/mount.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("waitForElement", () => {
  it("resolves immediately when element exists", async () => {
    document.body.innerHTML = `<div id="x"></div>`;
    const el = await waitForElement("#x");
    expect(el.id).toBe("x");
  });

  it("resolves after the element is added", async () => {
    setTimeout(() => {
      const d = document.createElement("div");
      d.id = "late";
      document.body.appendChild(d);
    }, 10);
    const el = await waitForElement("#late", { timeout: 1000 });
    expect(el.id).toBe("late");
  });

  it("rejects on timeout", async () => {
    await expect(waitForElement("#never", { timeout: 30 })).rejects.toThrow(/timeout/i);
  });
});

describe("mount", () => {
  it("runs setup once when the element is present", async () => {
    document.body.innerHTML = `<form data-form="x"></form>`;
    let runs = 0;
    const handle = await mount('[data-form="x"]', () => { runs++; }, { timeout: 100 });
    expect(runs).toBe(1);
    handle.stop();
  });

  it("runs setup once even if more matching nodes appear (without watchReplacement)", async () => {
    document.body.innerHTML = `<form data-form="x"></form>`;
    let runs = 0;
    const handle = await mount('[data-form="x"]', () => { runs++; }, { timeout: 100 });
    // add another matching node — should not cause re-run since watchReplacement is off
    const extra = document.createElement("form");
    extra.setAttribute("data-form", "x");
    document.body.appendChild(extra);
    await new Promise((r) => setTimeout(r, 30));
    expect(runs).toBe(1);
    handle.stop();
  });

  it("re-runs setup when the form is replaced (watchReplacement: true)", async () => {
    document.body.innerHTML = `<form data-form="y" id="orig"></form>`;
    const seen = [];
    const handle = await mount(
      '[data-form="y"]',
      (el) => { seen.push(el.id); return () => seen.push(`cleanup:${el.id}`); },
      { timeout: 100, watchReplacement: true }
    );
    // swap the node
    document.body.innerHTML = `<form data-form="y" id="swap"></form>`;
    await new Promise((r) => setTimeout(r, 30));
    handle.stop();
    expect(seen).toContain("orig");
    expect(seen).toContain("cleanup:orig");
    expect(seen).toContain("swap");
  });
});
