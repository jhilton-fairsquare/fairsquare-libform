// lib/presets/framer.js
//
// Drop-in preset for Fairsquare's Framer-deployed lead-capture forms.
// Wraps createForm with everything that mirrors the prod script.js:
//   - Class-based field selectors (.FullName, .Email, .Phone, …)
//   - Default validator chain per field
//   - All 9 plugins, registered in the correct order
//   - Cookie name `_nfIdSF` and auto-derived eTLD+1 domain
//   - Endpoint switch based on hostname
//
// Customization is intentionally narrow:
//   - `optional: [...]` removes `required()` from that field's chain
//   - `validators: { field: V.all(...) }` replaces the chain entirely
//   - `fieldClasses: { fieldName: ".CustomClass" }` overrides a selector
//   - Anything beyond that → drop the preset and call createForm directly.

import { createForm } from "../FormFactory.js";
import * as V from "../form-core/validators/index.js";
import { formatPhoneUS, formatZipUS, stripDashes } from "../form-core/formatters/index.js";

import { attributionPlugin } from "../form-core/plugins/attribution.js";
import { queryParamsPlugin } from "../form-core/plugins/queryParams.js";
import { tierMapPlugin } from "../form-core/plugins/tierMap.js";
import { staticFieldsPlugin } from "../form-core/plugins/staticFields.js";
import { fbclidResyncPlugin } from "../form-core/plugins/fbclidResync.js";
import { submitButtonPlugin } from "../form-core/plugins/submitButton.js";
import { dataLayerPlugin } from "../form-core/plugins/dataLayer.js";
import { redirectOnUrlPlugin } from "../form-core/plugins/redirectOnUrl.js";
import { serverValidationPlugin } from "../form-core/plugins/serverValidation.js";

// Default Framer class-name → form field name + validator + format.
// Order matters: it determines validation message order on a fresh submit.
const DEFAULT_FIELDS = {
  fullName:              { class: "FullName",              validate: () => V.fullNameLettersOnly() },
  firstName:             { class: "FirstName",             validate: () => V.lettersHyphenSpaces("Please enter your first name.") },
  lastName:              { class: "LastName",              validate: () => V.lettersHyphenSpaces("Please enter your last name.") },
  businessName:          { class: "BusinessName",          validate: () => V.lettersHyphenSpaces("Please enter your business name.") },
  email:                 { class: "Email",                 validate: () => V.emailStrict() },
  phone:                 { class: "Phone",                 validate: () => V.phoneUS(),   format: formatPhoneUS },
  zipCode:               { class: "ZipCode",               validate: () => V.zipUS(),     format: formatZipUS },
  salesDistributionTier: { class: "SalesDistributionTier", validate: () => V.requiredSelect(), kind: "select", coreRule: "select" },
  consent:               { class: "PrivacyPolicyAccepted", validate: () => V.mustAccept(),     kind: "checkbox", coreRule: "accept" },
};

// API fields that should be omitted from the payload when their form value
// is empty (rather than sent as ""). The Lead Gateway accepts unknown fields
// but enforces format on known ones — sending businessName: "" against a
// 2-100 char rule would 400.
const OMIT_WHEN_EMPTY = new Set(["businessName", "zipCode", "firstName", "lastName"]);

const isPresent = (root, klass) => {
  if (!root) return false;
  return root.querySelector(`.${klass}`) != null;
};

const findRoot = (id) => {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector(`[data-form="${id}"]`) ||
    document.getElementById(id) ||
    null
  );
};

const readByClass = (root, klass) => {
  if (!root) return "";
  const wrap = root.querySelector(`.${klass}`);
  if (!wrap) return "";
  // The wrapper itself is the input on some Framer setups.
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
 * @param {string}   [config.journey]       routing parameter (e.g., "NFCoreApply")
 * @param {string}   config.gaFormType      dataLayer `form_type` (e.g., "large_stand_alone_apply_now")
 * @param {string}   [config.endpoint]      override the auto-derived endpoint
 * @param {string}   [config.source="NF"]
 * @param {string}   [config.responseChannel="Internet"]
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
    responseChannel = "Internet",
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
  } = config;

  if (!id) throw new Error("framerForm: `id` is required");
  if (!formType) throw new Error("framerForm: `formType` is required");
  if (!gaFormType) throw new Error("framerForm: `gaFormType` is required");

  const optionalSet = new Set(optional);

  // Resolve which default fields should be wired up. We probe the DOM after
  // mount via a wrapped get() — fields whose class wrapper isn't present
  // get a no-op validator and a "" value (the onSubmit step strips them).
  const fields = {};
  for (const [name, def] of Object.entries(DEFAULT_FIELDS)) {
    const klass = fieldClasses[name] || def.class;

    // Each field's get() reads from the form root, by class.
    const get = () => readByClass(findRoot(id), klass);

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

    // Skip-if-not-on-this-form: wrap so a missing wrapper passes validation.
    const wrappedValidate = async (value, values) => {
      if (!isPresent(findRoot(id), klass)) return { valid: true, message: "" };
      return validate(value, values);
    };

    fields[name] = { get, validate: wrappedValidate };
    if (def.format) fields[name].format = def.format;
  }

  // Default payload mapper: include only fields that have values (or are
  // structurally required). The spec accepts unknown fields but enforces
  // format on known ones.
  const defaultOnSubmit = (values) => {
    const out = {
      consent: values.consent === "on" || values.consent === true,
    };
    if (values.fullName)  out.fullName  = values.fullName;
    if (values.firstName) out.firstName = values.firstName;
    if (values.lastName)  out.lastName  = values.lastName;
    if (values.email)     out.email     = values.email;
    if (values.phone)     out.phone     = stripDashes(values.phone);
    for (const k of Object.keys(values)) {
      if (k in out) continue;
      if (OMIT_WHEN_EMPTY.has(k) && !values[k]) continue;
      // Pass through everything else (zipCode, businessName, etc.) when set.
      if (values[k] !== "" && values[k] != null) out[k] = values[k];
    }
    return out;
  };

  // Default dataLayer params — match the spec's GA event shape.
  const defaultDataLayerParams = {
    event_tier: { source: "form",     name: "salesDistributionTier" },
    tierDetail: { source: "form",     name: "salesDistributionTier", as: "label" },
    zip_code:   { source: "form",     name: "zipCode",               default: "" },
    event_card: { source: "response", path: "event_card",            default: "no card submitted" },
    state:      { source: "response", path: "state",                 default: "" },
  };

  return createForm({
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
      tierMapPlugin(),
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
}
