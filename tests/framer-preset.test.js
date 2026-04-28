import { describe, it, expect, vi, beforeEach } from "vitest";
import { framerForm } from "../lib/presets/framer.js";
import * as V from "../lib/form-core/validators/index.js";

const fakeTransport = (response = { success: true, url: "https://nf.example/apply" }) => ({
  send: vi.fn(async () => response),
});

const buildForm = (id, html) => {
  document.body.innerHTML = `
    <form data-form="${id}" id="${id}" novalidate>
      ${html}
      <button type="submit">Apply</button>
    </form>
  `;
  return document.querySelector(`#${id}`);
};

const submit = (id) => {
  document.querySelector(`#${id}`).dispatchEvent(
    new Event("submit", { cancelable: true, bubbles: true })
  );
};

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  document.body.innerHTML = "";
  // Reset cookies — preset persists NFID
  document.cookie.split(";").forEach((c) => {
    const eq = c.indexOf("=");
    const name = (eq > -1 ? c.slice(0, eq) : c).trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
});

describe("framerForm: required config", () => {
  it("throws when id is missing", () => {
    expect(() => framerForm({ formType: "Framer", gaFormType: "x" })).toThrow(/id/);
  });
  it("throws when formType is missing", () => {
    expect(() => framerForm({ id: "f", gaFormType: "x" })).toThrow(/formType/);
  });
  it("throws when gaFormType is missing", () => {
    expect(() => framerForm({ id: "f", formType: "Framer" })).toThrow(/gaFormType/);
  });
});

describe("framerForm: default form (full set of fields)", () => {
  const setupFull = (id = "f1") =>
    buildForm(
      id,
      `
        <div class="FullName"><input /></div>
        <div class="BusinessName"><input /></div>
        <div class="Email"><input /></div>
        <div class="Phone"><input /></div>
        <div class="ZipCode"><input /></div>
        <div class="SalesDistributionTier">
          <select>
            <option value="">--</option>
            <option value="Tier 2a">$250K-$499K</option>
          </select>
        </div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" /> Accept</label>
      `
    );

  it("submits a happy-path payload with prod-parity defaults", async () => {
    setupFull();
    const t = fakeTransport();
    const handle = framerForm({
      id: "f1",
      formType: "Framer",
      journey: "NFCoreApply",
      gaFormType: "large_stand_alone_apply_now",
      endpoint: "https://nf.example/api/forms/submit",
      navigate: () => {},
    });
    // Replace transport (preset's createForm builds its own; swap before submit)
    const ctrl = await handle.ready;
    ctrl.transport = t;

    document.querySelector(".FullName input").value = "Ada Lovelace";
    document.querySelector(".BusinessName input").value = "Lovelace Analytics";
    document.querySelector(".Email input").value = "ada@example.com";
    document.querySelector(".Phone input").value = "212-555-0100";
    document.querySelector(".ZipCode input").value = "10001";
    document.querySelector(".SalesDistributionTier select").value = "Tier 2a";
    document.querySelector(".PrivacyPolicyAccepted input").checked = true;

    submit("f1");
    await tick();

    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];

    // Form-data fields
    expect(payload).toMatchObject({
      fullName: "Ada Lovelace",
      businessName: "Lovelace Analytics",
      email: "ada@example.com",
      phone: "2125550100",        // dashes stripped
      zipCode: "10001",
      consent: true,
    });
    // Routing statics
    expect(payload).toMatchObject({
      source: "NF",
      formType: "Framer",
      journey: "NFCoreApply",
      responseChannel: "Internet",
    });
    // Tier mapping
    expect(payload.salesDistributionTier).toBe("Tier 2");
    expect(payload.annualRevenueRange).toBe("$250K-$499K");
    // Attribution
    expect(payload.nfid).toMatch(/^NFID-/);
    expect(typeof payload.landingPage).toBe("string");
  });

  it("rejects an invalid email and never calls transport", async () => {
    setupFull();
    const t = fakeTransport();
    const handle = framerForm({
      id: "f1",
      formType: "Framer",
      gaFormType: "large_stand_alone_apply_now",
      navigate: () => {},
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;

    document.querySelector(".FullName input").value = "Ada Lovelace";
    document.querySelector(".BusinessName input").value = "X";
    document.querySelector(".Email input").value = "not-an-email";
    document.querySelector(".Phone input").value = "212-555-0100";
    document.querySelector(".ZipCode input").value = "10001";
    document.querySelector(".SalesDistributionTier select").value = "Tier 2a";
    document.querySelector(".PrivacyPolicyAccepted input").checked = true;

    submit("f1");
    await tick();

    expect(t.send).not.toHaveBeenCalled();
  });
});

describe("framerForm: auto-skip missing field wrappers", () => {
  it("a form without .BusinessName / .ZipCode still validates and submits", async () => {
    buildForm(
      "f2",
      `
        <div class="FullName"><input value="Ada Lovelace" /></div>
        <div class="Email"><input value="ada@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="SalesDistributionTier">
          <select>
            <option value="">--</option>
            <option value="Tier 2a" selected>$250K-$499K</option>
          </select>
        </div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
      `
    );

    const t = fakeTransport();
    const handle = framerForm({
      id: "f2",
      formType: "Framer",
      gaFormType: "large_footer_form_apply_now",
      navigate: () => {},
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;

    submit("f2");
    await tick();

    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];
    expect(payload).toMatchObject({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "2125550100",
      consent: true,
    });
    // Missing fields are NOT sent (would 400 if they were "")
    expect(payload.businessName).toBeUndefined();
    expect(payload.zipCode).toBeUndefined();
  });
});

describe("framerForm: optional[] only relaxes required, keeps rule for non-empty values", () => {
  it("zipCode in optional[]: empty passes; bad value still fails", async () => {
    buildForm(
      "f3",
      `
        <div class="FullName"><input value="Ada Lovelace" /></div>
        <div class="Email"><input value="ada@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="ZipCode"><input value="" /></div>
        <div class="SalesDistributionTier">
          <select>
            <option value="">--</option>
            <option value="Tier 2a" selected>$250K-$499K</option>
          </select>
        </div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
      `
    );

    const t = fakeTransport();
    const handle = framerForm({
      id: "f3",
      formType: "Framer",
      gaFormType: "large_stand_alone_apply_now",
      optional: ["zipCode"],
      navigate: () => {},
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;

    // First submit: empty zip is allowed
    submit("f3");
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0][0].zipCode).toBeUndefined();

    // Now fill zip with a bad value — zipUS should still fire
    t.send.mockClear();
    document.querySelector(".ZipCode input").value = "123";
    submit("f3");
    await tick();
    expect(t.send).not.toHaveBeenCalled();

    // Fix the zip — submit again, this time we expect zipCode in payload
    document.querySelector(".ZipCode input").value = "10001";
    submit("f3");
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0][0].zipCode).toBe("10001");
  });
});

describe("framerForm: validators{} replaces a chain entirely", () => {
  it("custom businessName validator is used instead of default", async () => {
    buildForm(
      "f4",
      `
        <div class="FullName"><input value="Ada Lovelace" /></div>
        <div class="BusinessName"><input value="3M" /></div>
        <div class="Email"><input value="ada@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="ZipCode"><input value="10001" /></div>
        <div class="SalesDistributionTier">
          <select><option value="">--</option><option value="Tier 2a" selected>$250K-$499K</option></select>
        </div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
      `
    );

    const t = fakeTransport();
    const handle = framerForm({
      id: "f4",
      formType: "Framer",
      gaFormType: "large_stand_alone_apply_now",
      navigate: () => {},
      validators: {
        // Default would reject "3M" (lettersHyphenSpaces); allow it.
        businessName: V.all(V.required(), V.minLength(2), V.maxLength(100)),
      },
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;

    submit("f4");
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0][0].businessName).toBe("3M");
  });
});

describe("framerForm: two presets on the same page", () => {
  it("each form sends its own gaFormType and routes independently", async () => {
    document.body.innerHTML = `
      <form data-form="f5a" id="f5a">
        <div class="FullName"><input value="Ada A" /></div>
        <div class="Email"><input value="a@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="SalesDistributionTier"><select><option value="Tier 1a" selected>Under $120K</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
        <button type="submit">Go</button>
      </form>
      <form data-form="f5b" id="f5b">
        <div class="FullName"><input value="Ada B" /></div>
        <div class="Email"><input value="b@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="SalesDistributionTier"><select><option value="Tier 3" selected>Over $1M</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
        <button type="submit">Go</button>
      </form>
    `;

    const t1 = fakeTransport();
    const t2 = fakeTransport();
    const h1 = framerForm({ id: "f5a", formType: "Framer", gaFormType: "form_a", navigate: () => {} });
    const h2 = framerForm({ id: "f5b", formType: "Framer", gaFormType: "form_b", navigate: () => {} });
    const c1 = await h1.ready; c1.transport = t1;
    const c2 = await h2.ready; c2.transport = t2;

    submit("f5a");
    submit("f5b");
    await tick();

    expect(t1.send).toHaveBeenCalledTimes(1);
    expect(t2.send).toHaveBeenCalledTimes(1);
    expect(t1.send.mock.calls[0][0].fullName).toBe("Ada A");
    expect(t2.send.mock.calls[0][0].fullName).toBe("Ada B");
    expect(t1.send.mock.calls[0][0].annualRevenueRange).toBe("Under $120K");
    expect(t2.send.mock.calls[0][0].annualRevenueRange).toBe("Over $1M");
  });
});

describe("framerForm: FirstName/LastName variant (no FullName wrapper)", () => {
  it("auto-skips fullName and validates first+last instead", async () => {
    buildForm(
      "f6",
      `
        <div class="FirstName"><input value="Ada" /></div>
        <div class="LastName"><input value="Lovelace" /></div>
        <div class="Email"><input value="ada@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="ZipCode"><input value="10001" /></div>
        <div class="SalesDistributionTier"><select><option value="Tier 2a" selected>X</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "f6", formType: "Framer", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("f6");
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];
    expect(payload.firstName).toBe("Ada");
    expect(payload.lastName).toBe("Lovelace");
    expect(payload.fullName).toBeUndefined();
  });
});
