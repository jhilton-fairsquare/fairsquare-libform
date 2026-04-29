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
            <option value="$250K-$499K">$250K-$499K</option>
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
    document.querySelector(".SalesDistributionTier select").value = "$250K-$499K";
    document.querySelector(".PrivacyPolicyAccepted input").checked = true;

    submit("f1");
    await tick();

    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];

    // Spec-documented form-data fields
    expect(payload).toMatchObject({
      fullName: "Ada Lovelace",
      businessName: "Lovelace Analytics",
      email: "ada@example.com",
      phone: "2125550100",        // dashes stripped
      zipCode: "10001",
      consent: true,
    });
    // Routing statics — `journey` is passed through because the test passed it;
    // `responseChannel` is NOT in the default payload (not in API spec).
    expect(payload).toMatchObject({
      source: "NF",
      formType: "Framer",
      journey: "NFCoreApply",
    });
    expect(payload.responseChannel).toBeUndefined();
    // Tier mapping: only the spec-documented annualRevenueRange ships
    expect(payload.annualRevenueRange).toBe("$250K-$499K");
    expect(payload.salesDistributionTier).toBeUndefined();
    // Attribution: nfid is NOT shipped (not in API spec)
    expect(payload.nfid).toBeUndefined();
    expect(payload.path).toBeUndefined();
    expect(typeof payload.landingPage).toBe("string");
    expect(typeof payload.clientBrowser).toBe("string");
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
    document.querySelector(".SalesDistributionTier select").value = "$250K-$499K";
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
            <option value="$250K-$499K" selected>$250K-$499K</option>
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
            <option value="$250K-$499K" selected>$250K-$499K</option>
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
          <select><option value="">--</option><option value="$250K-$499K" selected>$250K-$499K</option></select>
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
        <div class="SalesDistributionTier"><select><option value="Under $120K" selected>Under $120K</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
        <button type="submit">Go</button>
      </form>
      <form data-form="f5b" id="f5b">
        <div class="FullName"><input value="Ada B" /></div>
        <div class="Email"><input value="b@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="SalesDistributionTier"><select><option value="Over $1M" selected>Over $1M</option></select></div>
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

describe("framerForm: name= attribute resolution (primary)", () => {
  it("resolves every field by name= when no classes are present", async () => {
    buildForm(
      "n1",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <select name="salesDistributionTier">
          <option value="$250K-$499K" selected>$250K-$499K</option>
        </select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({
      id: "n1",
      formType: "Framer",
      gaFormType: "x",
      navigate: () => {},
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("n1");
    await tick();

    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];
    expect(payload).toMatchObject({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "2125550100",
      consent: true,
    });
    expect(payload.annualRevenueRange).toBe("$250K-$499K");
    expect(payload.salesDistributionTier).toBeUndefined(); // not in API spec
  });

  it("name= on the input takes precedence over a class match elsewhere", async () => {
    // Two inputs share the form root: one wired by name=, one carrying the
    // legacy class. The name= match should win.
    buildForm(
      "n2",
      `
        <input name="email" value="ada@example.com" />
        <div class="Email"><input value="legacy@example.com" /></div>
        <input name="fullName" value="Ada Lovelace" />
        <input name="phone" value="2125550100" />
        <select name="salesDistributionTier"><option value="$250K-$499K" selected>X</option></select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "n2", formType: "Framer", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("n2");
    await tick();
    expect(t.send.mock.calls[0][0].email).toBe("ada@example.com");
  });

  it("mixes name= and class within the same form", async () => {
    buildForm(
      "n3",
      `
        <input name="fullName" value="Ada Lovelace" />
        <div class="Email"><input value="ada@example.com" /></div>
        <input name="phone" value="2125550100" />
        <div class="SalesDistributionTier"><select><option value="Under $120K" selected>U</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /></label>
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "n3", formType: "Framer", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("n3");
    await tick();
    const payload = t.send.mock.calls[0][0];
    expect(payload).toMatchObject({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "2125550100",
      consent: true,
    });
  });

  it("FirstName/LastName variant via name= combines into fullName (spec field) on the wire", async () => {
    buildForm(
      "n4",
      `
        <input name="firstName" value="Ada" />
        <input name="lastName"  value="Lovelace" />
        <input name="email"     value="ada@example.com" />
        <input name="phone"     value="2125550100" />
        <select name="salesDistributionTier"><option value="$250K-$499K" selected>X</option></select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "n4", formType: "Framer", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("n4");
    await tick();
    const payload = t.send.mock.calls[0][0];
    expect(payload.fullName).toBe("Ada Lovelace");
    expect(payload.firstName).toBeUndefined();
    expect(payload.lastName).toBeUndefined();
  });
});

describe("framerForm: dropdown can emit annualRevenueRange enum directly", () => {
  it("option value = API enum string yields annualRevenueRange verbatim", async () => {
    buildForm(
      "ar",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <select name="salesDistributionTier">
          <option value="Under $120K">Under $120K</option>
          <option value="$120K-$249K">$120K-$249K</option>
          <option value="$250K-$499K">$250K-$499K</option>
          <option value="$500K-$999K" selected>$500K-$999K</option>
          <option value="Over $1M">Over $1M</option>
        </select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "ar", formType: "Framer", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("ar");
    await tick();
    const payload = t.send.mock.calls[0][0];
    expect(payload.annualRevenueRange).toBe("$500K-$999K");
    expect(payload.salesDistributionTier).toBeUndefined();
  });

  it("legacy name=\"salesDistributionTier\" attribute still resolves (back-compat alt name)", async () => {
    // Pages wired with the older form-field name continue to work after the
    // v0.3.1 rename: DEFAULT_FIELDS.annualRevenueRange.altNames includes
    // "salesDistributionTier", so the resolver picks up either spelling.
    buildForm(
      "ar2",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <select name="salesDistributionTier">
          <option value="$500K-$999K" selected>$500K-$999K</option>
        </select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "ar2", formType: "Framer", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("ar2");
    await tick();
    const payload = t.send.mock.calls[0][0];
    expect(payload.annualRevenueRange).toBe("$500K-$999K");
  });
});

describe("framerForm: spec-conformance — wire payload contains only documented fields", () => {
  it("default payload has no salesDistributionTier, no nfid, no path, no responseChannel, no firstName/lastName", async () => {
    buildForm(
      "spec",
      `
        <input name="firstName" value="Ada" />
        <input name="lastName"  value="Lovelace" />
        <input name="email"     value="ada@example.com" />
        <input name="phone"     value="2125550100" />
        <select name="salesDistributionTier"><option value="$500K-$999K" selected>X</option></select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({
      id: "spec",
      formType: "Framer",
      gaFormType: "x",
      navigate: () => {},
      // Note: NOT passing journey or responseChannel — they should not appear.
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("spec");
    await tick();
    const payload = t.send.mock.calls[0][0];

    // Spec-documented fields present
    expect(payload.source).toBe("NF");
    expect(payload.formType).toBe("Framer");
    expect(payload.fullName).toBe("Ada Lovelace");
    expect(payload.email).toBe("ada@example.com");
    expect(payload.phone).toBe("2125550100");
    expect(payload.consent).toBe(true);
    expect(payload.annualRevenueRange).toBe("$500K-$999K");

    // Out-of-spec fields absent
    expect(payload.salesDistributionTier).toBeUndefined();
    expect(payload.firstName).toBeUndefined();
    expect(payload.lastName).toBeUndefined();
    expect(payload.nfid).toBeUndefined();
    expect(payload.path).toBeUndefined();
    expect(payload.responseChannel).toBeUndefined();
    expect(payload.journey).toBeUndefined();
  });

  it("journey and responseChannel are passed through ONLY when explicitly configured", async () => {
    buildForm(
      "spec2",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <select name="salesDistributionTier"><option value="$250K-$499K" selected>X</option></select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({
      id: "spec2",
      formType: "Framer",
      gaFormType: "x",
      journey: "NFCoreApply",
      responseChannel: "Internet",
      navigate: () => {},
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("spec2");
    await tick();
    const payload = t.send.mock.calls[0][0];
    expect(payload.journey).toBe("NFCoreApply");
    expect(payload.responseChannel).toBe("Internet");
  });
});

describe("framerForm: mount-time wiring diagnostic", () => {
  it("warns when required fields are reachable by neither name= nor class", async () => {
    document.body.innerHTML = `
      <form id="f-warn">
        <input class="some-framer-class" />
        <button type="submit">Apply</button>
      </form>
    `;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = framerForm({
      id: "f-warn",
      formType: "Framer",
      gaFormType: "x",
      navigate: () => {},
    });
    await handle.ready;
    await tick(); // let the .then() chained on ready run

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0];
    expect(msg).toContain('form "f-warn"');
    // Each missing field is hinted with both the name= and the legacy class.
    expect(msg).toContain('name="fullName"');
    expect(msg).toContain('name="email"');
    expect(msg).toContain('name="phone"');
    expect(msg).toContain('name="consent"');
    expect(msg).toContain(".FullName");
    expect(msg).toContain(".Email");
    expect(msg).toContain(".Phone");
    expect(msg).toContain(".PrivacyPolicyAccepted");
    // annualRevenueRange is workflow-required for some journeys and
    // intentionally absent on others (XPRS) — it's not in the warning's
    // hardcoded required-core list to avoid false positives.
    expect(msg).not.toContain('name="annualRevenueRange"');
    warn.mockRestore();
  });

  it("does not warn when all required fields resolve by name= alone", async () => {
    buildForm(
      "f-name-only",
      `
        <input name="fullName" />
        <input name="email" />
        <input name="phone" />
        <select name="salesDistributionTier"><option value="Under $120K">x</option></select>
        <input type="checkbox" name="consent" />
      `
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = framerForm({ id: "f-name-only", formType: "Framer", gaFormType: "x", navigate: () => {} });
    await handle.ready;
    await tick();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn when all required classes are present", async () => {
    buildForm(
      "f-ok",
      `
        <div class="FullName"><input value="Ada Lovelace" /></div>
        <div class="Email"><input value="ada@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="SalesDistributionTier"><select><option value="$250K-$499K" selected>X</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
      `
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = framerForm({ id: "f-ok", formType: "Framer", gaFormType: "x", navigate: () => {} });
    await handle.ready;
    await tick();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("accepts FirstName + LastName as the name pair", async () => {
    buildForm(
      "f-fl",
      `
        <div class="FirstName"><input value="Ada" /></div>
        <div class="LastName"><input value="Lovelace" /></div>
        <div class="Email"><input value="ada@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="SalesDistributionTier"><select><option value="$250K-$499K" selected>X</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" checked /> Accept</label>
      `
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = framerForm({ id: "f-fl", formType: "Framer", gaFormType: "x", navigate: () => {} });
    await handle.ready;
    await tick();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("quiet: true suppresses the warning even when classes are missing", async () => {
    document.body.innerHTML = `
      <form id="f-quiet"><button type="submit">Go</button></form>
    `;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = framerForm({
      id: "f-quiet",
      formType: "Framer",
      gaFormType: "x",
      navigate: () => {},
      quiet: true,
    });
    await handle.ready;
    await tick();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("respects fieldClasses overrides — warns about the overridden class name", async () => {
    document.body.innerHTML = `
      <form id="f-override">
        <div class="FullName"><input /></div>
        <div class="Phone"><input /></div>
        <div class="SalesDistributionTier"><select><option value="Under $120K" selected>x</option></select></div>
        <label class="PrivacyPolicyAccepted"><input type="checkbox" /></label>
        <button type="submit">Go</button>
      </form>
    `;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = framerForm({
      id: "f-override",
      formType: "Framer",
      gaFormType: "x",
      navigate: () => {},
      fieldClasses: { email: "MyEmailClass" },
    });
    await handle.ready;
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0];
    expect(msg).toContain(".MyEmailClass");
    expect(msg).not.toContain(".Email ");
    warn.mockRestore();
  });
});

describe("framerForm: FirstName/LastName variant (no FullName wrapper)", () => {
  it("auto-skips fullName and validates first+last; ships combined fullName on the wire", async () => {
    buildForm(
      "f6",
      `
        <div class="FirstName"><input value="Ada" /></div>
        <div class="LastName"><input value="Lovelace" /></div>
        <div class="Email"><input value="ada@example.com" /></div>
        <div class="Phone"><input value="2125550100" /></div>
        <div class="ZipCode"><input value="10001" /></div>
        <div class="SalesDistributionTier"><select><option value="$250K-$499K" selected>X</option></select></div>
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
    expect(payload.fullName).toBe("Ada Lovelace");
    expect(payload.firstName).toBeUndefined();
    expect(payload.lastName).toBeUndefined();
  });
});

describe("framerForm: Business Information fields (XPRS-style)", () => {
  it("XPRS layout — businessName + first/last + email + phone + businessZipCode + consent", async () => {
    buildForm(
      "xprs",
      `
        <input name="businessName"    value="Framer's Frames" />
        <input name="firstName"       value="Jacob" />
        <input name="lastName"        value="Smith" />
        <input name="email"           value="jane@framer.com" />
        <input name="phone"           value="415-555-0100" />
        <input name="businessZipCode" value="00001" />
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({
      id: "xprs",
      formType: "Framer-XPRS",
      gaFormType: "xprs_apply",
      journey: "XPRSApply",
      navigate: () => {},
    });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("xprs");
    await tick();

    // 00001 is a 5-digit string but fails the zipUS lower-bound (501) check
    // — verify the validator runs at the form layer (does NOT submit).
    expect(t.send).not.toHaveBeenCalled();

    // Use a valid ZIP and resubmit.
    document.querySelector('[name="businessZipCode"]').value = "10001";
    submit("xprs");
    await tick();

    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];
    expect(payload).toMatchObject({
      businessName: "Framer's Frames",
      fullName: "Jacob Smith",          // first/last combined per spec
      email: "jane@framer.com",
      phone: "4155550100",              // dashes stripped
      businessZipCode: "10001",
      consent: true,
      formType: "Framer-XPRS",
      journey: "XPRSApply",
    });
    expect(payload.firstName).toBeUndefined();
    expect(payload.lastName).toBeUndefined();
  });

  it("businessZipCode validator catches an invalid 5-digit ZIP", async () => {
    buildForm(
      "bz",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <input name="businessZipCode" value="abc12" />
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "bz", formType: "F", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("bz");
    await tick();
    expect(t.send).not.toHaveBeenCalled();
  });

  it("businessState validator: accepts valid 2-letter, rejects others", async () => {
    buildForm(
      "bs",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <input name="businessState" value="ZZ" />
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "bs", formType: "F", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("bs");
    await tick();
    expect(t.send).not.toHaveBeenCalled();

    document.querySelector('[name="businessState"]').value = "ca";
    submit("bs");
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0][0].businessState).toBe("ca");
  });

  it("entityType + industry validate against the spec enum and ship in the payload", async () => {
    buildForm(
      "ei",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <select name="entityType"><option value="LLC" selected>LLC</option></select>
        <select name="industry"><option value="Manufacturing" selected>Manufacturing</option></select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "ei", formType: "F", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("ei");
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0][0]).toMatchObject({
      entityType: "LLC",
      industry: "Manufacturing",
    });
  });

  it("entityType validator rejects a value outside the spec enum", async () => {
    buildForm(
      "et",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <select name="entityType"><option value="Cooperative" selected>Cooperative</option></select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "et", formType: "F", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("et");
    await tick();
    expect(t.send).not.toHaveBeenCalled();
  });

  it("forms without business fields are unaffected (auto-skip)", async () => {
    buildForm(
      "no-biz",
      `
        <input name="fullName" value="Ada Lovelace" />
        <input name="email"    value="ada@example.com" />
        <input name="phone"    value="2125550100" />
        <select name="annualRevenueRange"><option value="$250K-$499K" selected>X</option></select>
        <input type="checkbox" name="consent" checked />
      `
    );
    const t = fakeTransport();
    const handle = framerForm({ id: "no-biz", formType: "F", gaFormType: "x", navigate: () => {} });
    const ctrl = await handle.ready;
    ctrl.transport = t;
    submit("no-biz");
    await tick();
    expect(t.send).toHaveBeenCalledTimes(1);
    const payload = t.send.mock.calls[0][0];
    expect(payload.businessName).toBeUndefined();
    expect(payload.businessStreetAddress).toBeUndefined();
    expect(payload.businessCity).toBeUndefined();
    expect(payload.businessState).toBeUndefined();
    expect(payload.businessZipCode).toBeUndefined();
    expect(payload.entityType).toBeUndefined();
    expect(payload.industry).toBeUndefined();
  });
});
