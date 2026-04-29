// lib/presets/framer.js
//
// Drop-in preset for Fairsquare's Framer-deployed lead-capture forms.
// Wraps createForm with everything that mirrors the prod script.js:
//   - Field resolution by HTML `name` attribute (primary) with legacy
//     class-name fallback (.FullName, .Email, .Phone, …) for parity with
//     the prior prod script.js
//   - Default validator chain per field
//   - All 9 plugins, registered in the correct order
//   - Cookie name `_nfIdSF` and auto-derived eTLD+1 domain
//   - Endpoint switch based on hostname
//
// Authoring contract (preferred):
//   <input name="email" />, <input name="phone" />, etc. — Framer's
//   right-panel "Name" property sets this natively; no Code Override
//   required. Field keys are camelCase and match the spec-documented
//   wire field where applicable: fullName | firstName/lastName, email,
//   phone, businessName, zipCode, annualRevenueRange, consent.
//
// Authoring contract (legacy fallback):
//   <div class="Email"><input /></div>, …  — works on existing prod pages
//   that pre-date the name= path. Used only when name= is absent.
//
// Customization is intentionally narrow:
//   - `optional: [...]` removes `required()` from that field's chain
//   - `validators: { field: V.all(...) }` replaces the chain entirely
//   - `fieldClasses: { fieldName: "CustomClass" }` overrides the legacy class
//   - Anything beyond that → drop the preset and call createForm directly.

import { createForm } from "../FormFactory.js";
import * as V from "../form-core/validators/index.js";
import { ANNUAL_REVENUE_RANGES, ENTITY_TYPES, INDUSTRIES } from "../form-core/enums.js";
import { formatPhoneUS, formatZipUS, stripDashes } from "../form-core/formatters/index.js";

import { attributionPlugin } from "../form-core/plugins/attribution.js";
import { queryParamsPlugin } from "../form-core/plugins/queryParams.js";
import { staticFieldsPlugin } from "../form-core/plugins/staticFields.js";
import { fbclidResyncPlugin } from "../form-core/plugins/fbclidResync.js";
import { submitButtonPlugin } from "../form-core/plugins/submitButton.js";
import { dataLayerPlugin } from "../form-core/plugins/dataLayer.js";
import { redirectOnUrlPlugin } from "../form-core/plugins/redirectOnUrl.js";
import { serverValidationPlugin } from "../form-core/plugins/serverValidation.js";

// Default form-field key → resolution metadata + validator chain.
//
// `class` is the legacy CSS-class wrapper from prod's script.js (used
// as a fallback when name= is absent on the host).
// `altNames` is an optional list of additional `name=` values accepted
// for back-compat — used when an older form-field key (e.g.,
// "salesDistributionTier") is still wired on a published page.
//
// Order matters: it determines validation message order on a fresh submit.
const DEFAULT_FIELDS = {
  // Required (per API spec: source, formType, fullName, email, phone, consent)
  fullName:              { class: "FullName",              validate: () => V.fullNameLettersOnly() },
  firstName:             { class: "FirstName",             validate: () => V.lettersHyphenSpaces("Please enter your first name.") },
  lastName:              { class: "LastName",              validate: () => V.lettersHyphenSpaces("Please enter your last name.") },
  email:                 { class: "Email",                 validate: () => V.emailStrict() },
  phone:                 { class: "Phone",                 validate: () => V.phoneUS(),   format: formatPhoneUS },
  consent:               { class: "PrivacyPolicyAccepted", validate: () => V.mustAccept(),     kind: "checkbox", coreRule: "accept" },

  // Personal Information (spec lines 343-353)
  zipCode:               { class: "ZipCode",               validate: () => V.zipUS(),     format: formatZipUS },

  // Business Information (spec lines 357-370). Each is auto-skipped if the
  // form doesn't contain a matching input — adding them here makes them
  // available to any preset consumer without changing existing form behavior.
  // businessName: spec only constrains length (2-100 chars). The previous
  // lettersHyphenSpaces validator was a script.js-era port that rejected
  // legitimate business names like "Framer's Frames" (apostrophe), "AT&T"
  // (ampersand), "3M" (digits). Match the spec instead.
  businessName:          { class: "BusinessName",          validate: () => V.all(V.minLength(2, "Please enter your business name."), V.maxLength(100, "Business name must be 100 characters or fewer.")) },
  businessStreetAddress: { class: "BusinessStreetAddress", validate: () => V.minLength(2, "Please enter a street address.") },
  businessCity:          { class: "BusinessCity",          validate: () => V.minLength(2, "Please enter a city.") },
  businessState:         { class: "BusinessState",         validate: () => V.usState() },
  businessZipCode:       { class: "BusinessZipCode",       validate: () => V.zipUS(),     format: formatZipUS },
  entityType:            {
    class: "EntityType",
    validate: () => V.all(V.requiredSelect(), V.oneOf(ENTITY_TYPES, "Please select a valid entity type.")),
    kind: "select", coreRule: "select",
  },
  industry:              {
    class: "Industry",
    validate: () => V.all(V.requiredSelect(), V.oneOf(INDUSTRIES, "Please select a valid industry.")),
    kind: "select", coreRule: "select",
  },

  // Financial Information (spec lines 374-380). `annualRevenueRange` matches
  // the API field name 1:1; option value is the API enum directly. Validator
  // surfaces typos at the form layer rather than as a 400 from the gateway.
  // `salesDistributionTier` is accepted as a legacy alt name for pages
  // still wired with the previous form-field key.
  annualRevenueRange:    {
    class: "SalesDistributionTier",
    altNames: ["salesDistributionTier"],
    validate: () => V.all(
      V.requiredSelect(),
      V.oneOf(ANNUAL_REVENUE_RANGES, "Please select a valid revenue range.")
    ),
    kind: "select", coreRule: "select",
  },
};

// Spec-documented fields that should be omitted from the payload when
// their form value is empty (rather than sent as ""). The Lead Gateway
// enforces format on known fields — sending businessName: "" against a
// 2-100 char rule would 400.
const OMIT_WHEN_EMPTY = new Set(["businessName", "zipCode"]);

// Internal-only form-field keys: read from the DOM and used by validators,
// but never shipped on the wire. firstName/lastName are combined into
// `fullName` (the API parses fullName internally — see Field Reference).
const INTERNAL_FIELDS = new Set(["firstName", "lastName"]);

const findRoot = (id) => {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector(`[data-form="${id}"]`) ||
    document.getElementById(id) ||
    null
  );
};

// Resolve the form-item element for a field. Tries the canonical HTML
// `name` attribute first, then any back-compat alt names, then falls back
// to the legacy class wrapper (parity with prod script.js and pages that
// pre-date the name= contract). Returns the matched element or null.
const resolveField = (root, name, klass, altNames = []) => {
  if (!root) return null;
  const candidates = [name, ...altNames];
  for (const n of candidates) {
    const el = root.querySelector(`[name="${n}"]`);
    if (el) return el;
  }
  return root.querySelector(`.${klass}`) || null;
};

const fieldPresent = (root, name, klass, altNames) =>
  resolveField(root, name, klass, altNames) != null;

const readField = (root, name, klass, altNames) => {
  const wrap = resolveField(root, name, klass, altNames);
  if (!wrap) return "";
  // The matched element itself is the input on some setups (a name= directly
  // on the <input>, or a class on the <input>).
  if (wrap.matches("input, select, textarea")) {
    if (wrap.type === "checkbox") return wrap.checked ? "on" : "";
    return (wrap.value || "").toString();
  }
  // Otherwise look for the input inside the wrapper.
  const inner = wrap.querySelector("input, select, textarea");
  if (!inner) return "";
  if (inner.type === "checkbox") return inner.checked ? "on" : "";
  return (inner.value || "").toString();
};

const deriveCookieDomain = () => {
  if (typeof location === "undefined" || !location.hostname) return undefined;
  const parts = location.hostname.split(".");
  if (parts.length < 2) return undefined; // localhost / IP
  return "." + parts.slice(-2).join(".");
};

const defaultEndpoint = () => {
  if (typeof location === "undefined") return "";
  return location.hostname.indexOf("nationalfunding") !== -1
    ? "https://www.nationalfunding.com/api/forms/submit"
    : "https://stage.nationalfunding.com/api/forms/submit";
};

// Wrap a validator so it returns OK for empty values (i.e., make the field
// optional). The non-empty validator still applies if the user fills the
// field — we just stop requiring it.
const optionalize = (validator) => async (value, values) => {
  const s = value == null ? "" : String(value).trim();
  if (s === "") return { valid: true, message: "" };
  return validator(value, values);
};

/**
 * framerForm
 *
 * @param {object}   config
 * @param {string}   config.id              form id (matches the element's id or data-form)
 * @param {string}   config.formType        case-sensitive routing key (e.g., "Framer")
 * @param {string}   config.gaFormType      dataLayer `form_type` (e.g., "large_stand_alone_apply_now")
 * @param {string}   [config.endpoint]      override the auto-derived endpoint
 * @param {string}   [config.source="NF"]   spec-required; default is correct
 * @param {string}   [config.journey]       NOT in published API spec — pass only if your NF deployment requires it
 * @param {string}   [config.responseChannel] NOT in published API spec — pass only if your NF deployment requires it
 * @param {string}   [config.cookieName="_nfIdSF"]
 * @param {string}   [config.cookieDomain]  defaults to eTLD+1 of location.hostname
 * @param {string[]} [config.optional]      field names that should not require a non-empty value
 * @param {Record<string, Validator>} [config.validators] replace a field's validator chain
 * @param {Record<string, string>}    [config.fieldClasses] override a field's class selector
 * @param {Record<string, any>}       [config.dataLayerParams] override/extend dataLayer params
 * @param {function} [config.onSubmit]      replace the default payload mapper
 * @param {function} [config.onSuccess]
 * @param {function} [config.onError]
 * @param {function} [config.navigate]      override the redirect side-effect
 *        (window.location.href). Useful for SPA routing or test stubs.
 * @param {boolean}  [config.quiet=false]   suppress the mount-time wiring diagnostic
 *
 * @returns {{ ready: Promise, controller: () => any, stop: () => void }}
 */
export function framerForm(config) {
  const {
    id,
    formType,
    journey,
    gaFormType,
    endpoint = defaultEndpoint(),
    source = "NF",
    responseChannel,
    cookieName = "_nfIdSF",
    cookieDomain = deriveCookieDomain(),
    optional = [],
    validators: validatorOverrides = {},
    fieldClasses = {},
    dataLayerParams,
    onSubmit: onSubmitOverride,
    onSuccess,
    onError,
    navigate,
    quiet = false,
  } = config;

  if (!id) throw new Error("framerForm: `id` is required");
  if (!formType) throw new Error("framerForm: `formType` is required");
  if (!gaFormType) throw new Error("framerForm: `gaFormType` is required");

  const optionalSet = new Set(optional);

  // Resolve which default fields should be wired up. We probe the DOM after
  // mount via a wrapped get() — fields whose name= attribute and class wrapper
  // are both absent get a no-op validator and a "" value (the onSubmit step
  // strips them).
  const fields = {};
  for (const [name, def] of Object.entries(DEFAULT_FIELDS)) {
    const klass = fieldClasses[name] || def.class;
    const altNames = def.altNames || [];

    // Each field's get() reads from the form root, preferring [name="<key>"],
    // then [name="<altName>"], then .<className>.
    const get = () => readField(findRoot(id), name, klass, altNames);

    // Build the validator chain.
    let validate;
    if (validatorOverrides[name]) {
      validate = validatorOverrides[name];
    } else {
      const core = def.validate();
      // Required-by-default for everything except checkbox (mustAccept already
      // enforces presence) and select (requiredSelect already does too).
      const wantRequired = !optionalSet.has(name) && def.coreRule !== "accept" && def.coreRule !== "select";
      validate = wantRequired ? V.all(V.required(), core) : optionalize(core);
    }

    // Skip-if-not-on-this-form: wrap so a missing field passes validation.
    const wrappedValidate = async (value, values) => {
      if (!fieldPresent(findRoot(id), name, klass, altNames)) return { valid: true, message: "" };
      return validate(value, values);
    };

    fields[name] = { get, validate: wrappedValidate };
    if (def.format) fields[name].format = def.format;
  }

  // Default payload mapper: emit only spec-documented API fields.
  // - The API parses `fullName` internally into first/last (Field Reference,
  //   Required Fields). When the form has a single fullName input, ship its
  //   value. When the form has separate firstName + lastName inputs, combine
  //   them into fullName before shipping; never emit firstName/lastName.
  // - INTERNAL_FIELDS (firstName, lastName) are read from the DOM for
  //   validators but never make it to the wire.
  // - The `annualRevenueRange` form-field key matches the API field 1:1, so
  //   its value passes through directly. No tierMapPlugin in the default
  //   chain — pages that still use legacy "Tier 2b" option values can opt
  //   tierMapPlugin in explicitly.
  const defaultOnSubmit = (values) => {
    const out = {
      consent: values.consent === "on" || values.consent === true,
    };
    const combinedName = [values.firstName, values.lastName]
      .map((s) => (s == null ? "" : String(s).trim()))
      .filter(Boolean)
      .join(" ");
    const fullName = values.fullName || combinedName;
    if (fullName) out.fullName = fullName;
    if (values.email) out.email = values.email;
    if (values.phone) out.phone = stripDashes(values.phone);

    for (const k of Object.keys(values)) {
      if (k in out) continue;
      if (INTERNAL_FIELDS.has(k)) continue;
      if (OMIT_WHEN_EMPTY.has(k) && !values[k]) continue;
      if (values[k] !== "" && values[k] != null) out[k] = values[k];
    }
    return out;
  };

  // Default dataLayer params — match the spec's GA event shape. `event_tier`
  // / `tierDetail` are kept as the GA param names for backward-compat with
  // any existing GA configuration; the source is `annualRevenueRange` (the
  // form field key after the v0.3.1 rename).
  const defaultDataLayerParams = {
    event_tier: { source: "form",     name: "annualRevenueRange" },
    tierDetail: { source: "form",     name: "annualRevenueRange", as: "label" },
    zip_code:   { source: "form",     name: "zipCode",            default: "" },
    event_card: { source: "response", path: "event_card",         default: "no card submitted" },
    state:      { source: "response", path: "state",              default: "" },
  };

  const handle = createForm({
    id,
    endpoint,
    watchReplacement: true, // Framer can re-render forms; rebind if so
    fields,
    plugins: [
      attributionPlugin({
        clientId: {
          cookieName,
          persistDays: 365,
          sameSite: "Lax",
          secure: typeof location !== "undefined" && location.protocol === "https:",
          domain: cookieDomain,
        },
      }),
      queryParamsPlugin(),
      staticFieldsPlugin({ source, formType, journey, responseChannel }),
      fbclidResyncPlugin(),
      submitButtonPlugin(),
      serverValidationPlugin(),
      dataLayerPlugin({
        form_type: gaFormType,
        reliability: "auto",
        reliabilityTimeoutMs: 300,
        params: { ...defaultDataLayerParams, ...(dataLayerParams || {}) },
      }),
      redirectOnUrlPlugin(navigate ? { navigate } : undefined),
    ],
    onSubmit: onSubmitOverride || defaultOnSubmit,
    onSuccess,
    onError,
  });

  // Mount-time wiring diagnostic.
  // The wrappedValidate `fieldPresent` guard (above) deliberately treats a
  // missing field as "this field doesn't exist on this form, skip it." That
  // makes a single preset serve multiple form variants — but it also means a
  // page that's wired up to nothing submits an empty payload silently. Warn
  // once after mount when a required field is reachable by neither name= nor
  // its legacy class.
  if (!quiet && typeof console !== "undefined" && typeof console.warn === "function") {
    handle.ready
      .then(() => {
        const root = findRoot(id);
        if (!root) return;
        const cls = (n) => fieldClasses[n] || DEFAULT_FIELDS[n].class;
        const altNames = (n) => DEFAULT_FIELDS[n].altNames || [];
        const has = (n) => fieldPresent(root, n, cls(n), altNames(n));
        const hint = (n) => `name="${n}" (or legacy class ".${cls(n)}")`;
        const missing = [];
        if (!has("fullName") && !(has("firstName") && has("lastName"))) {
          missing.push(
            `name — set ${hint("fullName")} on one input, ` +
            `OR ${hint("firstName")} + ${hint("lastName")} on two separate inputs`
          );
        }
        // Only warn about the API-required core (email, phone, consent) plus
        // the name pair (handled separately above). Other fields like
        // annualRevenueRange / business* are workflow-required for some
        // journeys and intentionally absent on others — we'd produce false
        // positives if we hardcoded them here.
        for (const f of ["email", "phone", "consent"]) {
          if (!has(f)) missing.push(`${f} — set ${hint(f)} on the corresponding input`);
        }
        if (missing.length === 0) return;
        console.warn(
          `[libform/framer] form "${id}" is missing required field${missing.length === 1 ? "" : "s"}.\n` +
          `Validation will silently pass for unwired fields and the submission may go out empty.\n\n` +
          missing.map((m) => `  • ${m}`).join("\n") +
          `\n\nFix: in Framer's right panel, set each input's "Name" property to the value above. ` +
          `Pass { quiet: true } to suppress this check.`
        );
      })
      .catch(() => {});
  }

  return handle;
}
