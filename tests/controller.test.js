import { describe, it, expect, vi, beforeEach } from "vitest";
import { createForm } from "../lib/FormFactory.js";
import { all, required, emailStrict, phoneUS, mustAccept } from "../lib/form-core/validators/index.js";
import { formatPhoneUS } from "../lib/form-core/formatters/index.js";

const setupForm = () => {
  document.body.innerHTML = `
    <form data-form="t1" novalidate>
      <input name="email" />
      <input name="phone" />
      <label><input name="consent" type="checkbox" value="on" /> Accept</label>
      <button type="submit">Go</button>
    </form>
  `;
  return {
    form: document.querySelector('[data-form="t1"]'),
    email: document.querySelector('[name="email"]'),
    phone: document.querySelector('[name="phone"]'),
    consent: document.querySelector('[name="consent"]'),
    button: document.querySelector('[type="submit"]'),
  };
};

const getInput = (name) => () => {
  const el = document.querySelector(`[data-form="t1"] [name="${name}"]`);
  if (!el) return "";
  if (el.type === "checkbox") return el.checked ? "on" : "";
  return el.value;
};

const fakeTransport = (response) => ({
  send: vi.fn(async () => response ?? { success: true, url: "https://nf.example/apply" }),
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("FormController via createForm", () => {
  it("mounts a form identified only by id (no data-form attribute)", async () => {
    document.body.innerHTML = `
      <form id="t1" novalidate>
        <input name="email" />
        <button type="submit">Go</button>
      </form>
    `;
    const t = fakeTransport();
    const handle = createForm({
      id: "t1",
      transport: t,
      fields: { email: { get: getInput("email"), validate: all() } },
    });
    const ctrl = await handle.ready;
    expect(ctrl).toBeDefined();
    // The lib should have stamped data-form so downstream selectors work
    expect(document.querySelector("#t1").getAttribute("data-form")).toBe("t1");
  });

  it("ready resolves after the form mounts", async () => {
    setupForm();
    const t = fakeTransport();
    const handle = createForm({
      id: "t1",
      transport: t,
      fields: {
        email: { get: getInput("email"), validate: all(required(), emailStrict()) },
        phone: { get: getInput("phone"), validate: all(required(), phoneUS()), format: formatPhoneUS },
        consent: { get: getInput("consent"), validate: all(mustAccept()) },
      },
    });
    const ctrl = await handle.ready;
    expect(ctrl).toBeDefined();
    expect(ctrl.id).toBe("t1");
  });

  it("rejects ready if the form never mounts (timeout)", async () => {
    // No DOM
    const handle = createForm({
      id: "missing",
      transport: fakeTransport(),
      mountTimeout: 30,
      fields: {
        email: { get: () => "", validate: all() },
      },
      onError: () => {}, // swallow the rejection side-effect
    });
    await expect(handle.ready).rejects.toThrow(/timeout/i);
  });

  it("submitting an invalid form does not call transport", async () => {
    const els = setupForm();
    const t = fakeTransport();
    const handle = createForm({
      id: "t1",
      transport: t,
      fields: {
        email: { get: getInput("email"), validate: all(required(), emailStrict()) },
        phone: { get: getInput("phone"), validate: all(required(), phoneUS()), format: formatPhoneUS },
        consent: { get: getInput("consent"), validate: all(mustAccept()) },
      },
    });
    await handle.ready;
    els.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(t.send).not.toHaveBeenCalled();
    expect(els.form.querySelectorAll(".field-error").length).toBeGreaterThan(0);
  });

  it("happy path: valid form submits payload through transport, calls onSuccess", async () => {
    const els = setupForm();
    els.email.value = "ada@example.com";
    els.phone.value = "212-555-0100";
    els.consent.checked = true;

    const t = fakeTransport({ success: true, url: "https://nf.example/apply" });
    const onSuccess = vi.fn();

    const handle = createForm({
      id: "t1",
      transport: t,
      fields: {
        email: { get: getInput("email"), validate: all(required(), emailStrict()) },
        phone: { get: getInput("phone"), validate: all(required(), phoneUS()), format: formatPhoneUS },
        consent: { get: getInput("consent"), validate: all(mustAccept()) },
      },
      onSubmit: (v) => ({ source: "NF", ...v }),
      onSuccess,
    });
    await handle.ready;

    els.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));

    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];
    expect(payload).toMatchObject({
      source: "NF",
      email: "ada@example.com",
      phone: "212-555-0100",
      consent: "on",
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://nf.example/apply" }),
      expect.anything(),
    );
  });

  it("live-formatter is bound on input event", async () => {
    const els = setupForm();
    const handle = createForm({
      id: "t1",
      transport: fakeTransport(),
      fields: {
        email: { get: getInput("email"), validate: all() },
        phone: { get: getInput("phone"), validate: all(), format: formatPhoneUS },
        consent: { get: getInput("consent"), validate: all() },
      },
    });
    await handle.ready;
    els.phone.value = "2125550100";
    els.phone.dispatchEvent(new Event("input"));
    expect(els.phone.value).toBe("212-555-0100");
  });

  it("setFieldErrors marks inputs and renders messages", async () => {
    const els = setupForm();
    const handle = createForm({
      id: "t1",
      transport: fakeTransport(),
      fields: {
        email: { get: getInput("email"), validate: all() },
        phone: { get: getInput("phone"), validate: all() },
        consent: { get: getInput("consent"), validate: all() },
      },
    });
    const ctrl = await handle.ready;
    ctrl.setFieldErrors({ email: "Bad email", phone: "Bad phone" });
    expect(els.email.classList.contains("is-invalid")).toBe(true);
    expect(els.phone.getAttribute("aria-invalid")).toBe("true");
    const errors = els.form.querySelectorAll(".field-error");
    const texts = Array.from(errors).map((e) => e.textContent);
    expect(texts).toContain("Bad email");
    expect(texts).toContain("Bad phone");

    ctrl.clearAllErrors();
    expect(els.email.classList.contains("is-invalid")).toBe(false);
  });

  it("onError fires (and receives TransportError) when transport throws", async () => {
    const els = setupForm();
    els.email.value = "ada@example.com";
    els.phone.value = "212-555-0100";
    els.consent.checked = true;

    const error = Object.assign(new Error("fail"), {
      name: "TransportError",
      status: 400,
      body: { fields: ["email"] },
    });
    const t = { send: vi.fn(async () => { throw error; }) };
    const onError = vi.fn();

    const handle = createForm({
      id: "t1",
      transport: t,
      fields: {
        email: { get: getInput("email"), validate: all(required(), emailStrict()) },
        phone: { get: getInput("phone"), validate: all(required(), phoneUS()) },
        consent: { get: getInput("consent"), validate: all(mustAccept()) },
      },
      onError,
    });
    await handle.ready;
    els.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(onError).toHaveBeenCalledWith(error, expect.anything());
  });
});
