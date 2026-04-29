# fairsquare-libform

A small, extensible form-handling library for Fairsquare lead-capture pages. Validates user input, normalizes it for the National Funding Lead Gateway API, attaches attribution data, fires GA dataLayer events without losing them to navigation races, and redirects the applicant to the URL the gateway returns.

Drop-in via `<script src>` for Framer/Webflow, or import as ESM in a build pipeline.

- Zero runtime dependencies, ~28 KB minified IIFE bundle
- 246 tests covering validators, transport, plugin pipeline, controller integration, framer preset
- **Spec-conformant by default** — the wire payload contains only fields documented in the [NF Lead Gateway Integration Guide](../NF-Lead-Gateway-Vendor-Integration-Guide.md). Out-of-spec script.js artifacts (`salesDistributionTier`, `nfid`, `path`, `firstName`/`lastName` as separate fields) are no longer shipped on the wire.
- Plugin lifecycle: `init → enrich → onBeforeSend → transport → onAfterSend → onSuccess|onError`
- Structured response handling for the Lead Gateway shape (`{ success, url, fields[], missingFields[] }`)
- AbortController timeouts, optional `Idempotency-Key`, `credentials: 'omit'` by default

---

## Install

### Framer / Webflow / plain HTML (IIFE drop-in)

```html
<script src="https://cdn.jsdelivr.net/gh/jhilton-fairsquare/fairsquare-libform@v0.3.2/dist/fairsquare-form.iife.min.js"></script>
<script>
  const { createForm, validators, formatters, plugins, presets } = FairsquareForm;
  // …configure as below; for Fairsquare landing pages, use presets.framer
</script>
```

Pin to a tag in production. To roll out a change: edit source, `npm run build`, commit (source + dist together), tag, update the URL in Framer.

### npm / build pipeline (ESM)

```bash
npm install github:jhilton-fairsquare/fairsquare-libform#v0.3.2
```

```js
import { createForm } from "@fairsquare/libform";
import { all, required, emailStrict, phoneUS, mustAccept } from "@fairsquare/libform/lib/form-core/validators/index.js";
// …
```

Or import the bundled ESM directly:

```js
import { createForm, validators, plugins } from "@fairsquare/libform/dist/fairsquare-form.esm.min.js";
```

---

## Quick start — Framer drop-in

For Fairsquare's standard Framer landing pages, use the `framer` preset. It handles strict validators, all 9 plugins in the right order, the `_nfIdSF` cookie, the eTLD+1 cookie domain, and the endpoint switch by hostname. Fields resolve by HTML `name` attribute (Framer's right-panel "Name" property sets this natively — no Code Override required), with a legacy class-name fallback for hosts that pre-date the `name=` contract.

**The wire payload contains only fields documented in the [NF Lead Gateway Integration Guide](../NF-Lead-Gateway-Vendor-Integration-Guide.md) Field Reference.** Form-field keys match the API field names 1:1 wherever possible (e.g., `annualRevenueRange` is both the form key and the wire field). The only internal-only keys are `firstName`/`lastName`, which are read for validators and combined into `fullName` before submission per the spec.

```html
<script src="https://cdn.jsdelivr.net/gh/jhilton-fairsquare/fairsquare-libform@v0.3.2/dist/fairsquare-form.iife.min.js"></script>
<!-- v0.3.2: Business Information fields added to DEFAULT_FIELDS — businessStreetAddress, businessCity, businessState, businessZipCode, entityType, industry. Auto-skip means existing forms are unaffected; XPRS-style forms can now wire these inputs by name=. -->
<script>
  FairsquareForm.presets.framer({
    id: "framer-form-1",
    formType: "Framer",
    gaFormType: "large_stand_alone_apply_now",
  });

  FairsquareForm.presets.framer({
    id: "framer-form-2",
    formType: "Framer",
    gaFormType: "large_footer_form_apply_now",
  });
</script>
```

That's the full configuration for two forms. The preset handles attribution, query-param capture, fbclid resync, dataLayer events, server-validation surfacing, and the redirect contract — all wired in the correct order.

### On the Framer canvas — what to set

Each form input needs a `name=` attribute matching the form key the library expects. In Framer, set this via the right panel → **Name** property (no Code Override needed). The form root needs an **Identifier** matching the `id` you passed to `presets.framer({ id: ..., })`.

The preset auto-skips fields that aren't on the form, so you only wire the inputs your specific journey actually uses. Two common layouts:

#### NFCoreApply layout (revenue dropdown)

| Input | `name=` |
|---|---|
| Full name (single input) | `fullName` |
| —or— First name + Last name | `firstName` + `lastName` |
| Email | `email` |
| Phone | `phone` |
| Annual sales `<select>` | `annualRevenueRange` |
| Consent checkbox | `consent` |

#### XPRSApply layout (business cluster, no revenue dropdown)

| Input | `name=` |
|---|---|
| Business name | `businessName` |
| First name | `firstName` |
| Last name | `lastName` |
| Email | `email` |
| Phone | `phone` |
| Business ZIP | `businessZipCode` |
| Consent checkbox | `consent` |

#### Common additions (any journey)

| Input | `name=` |
|---|---|
| Personal ZIP | `zipCode` |
| Business street address | `businessStreetAddress` |
| Business city | `businessCity` |
| Business state (2-letter) | `businessState` |
| Entity type `<select>` | `entityType` |
| Industry `<select>` | `industry` |

#### Dropdown option values

For `<select>` inputs, the `<option value="…">` must match the API enum exactly — labels are free-form, but the value is what gets shipped:

- `annualRevenueRange`: `Under $120K`, `$120K-$249K`, `$250K-$499K`, `$500K-$999K`, `Over $1M`
- `entityType`: `Sole Proprietorship`, `Partnership`, `S Corp`, `C Corp`, `LLC`
- `industry`: see [`enums.INDUSTRIES`](./lib/form-core/enums.js) (21 values)

The validators reject any other value at the form layer, so a typo fails fast in dev rather than as a 400 from the gateway.

#### Back-compat for existing prod pages

Pages already wired with the legacy class hooks (`.FullName`, `.Email`, `.Phone`, `.SalesDistributionTier`, `.PrivacyPolicyAccepted`, …) continue to work — the resolver tries `name=` first and falls back to class. No change needed for the existing NFCore prod pages. Pages with the older `name="salesDistributionTier"` (pre-v0.3.1) also resolve correctly via the alt-name list.

### Customizing the preset

Two override knobs handle the common cases:

```js
const V = FairsquareForm.validators;

FairsquareForm.presets.framer({
  id: "framer-form-2",
  formType: "Framer",
  journey: "NFCoreApply",
  gaFormType: "large_footer_form_apply_now",

  // Field names that should not require a non-empty value. Validators still
  // run if the user fills the field — we just stop requiring it.
  optional: ["businessName", "zipCode"],

  // Replace a field's validator chain entirely.
  validators: {
    businessName: V.all(V.required(), V.minLength(2), V.maxLength(100)),
    email: V.all(V.required(), V.emailStrict(), V.pattern(/@partner\.com$/, "Must use a partner email")),
  },
});
```

**Other preset options:** `endpoint`, `source`, `cookieName`, `cookieDomain`, `fieldClasses` (override the legacy class selector for a field), `dataLayerParams` (extend GA params), `onSubmit` (replace payload mapping), `onSuccess`, `onError`, `navigate` (replace `window.location.href` for SPA routing), `quiet` (suppress the mount-time wiring diagnostic).

**Non-spec opt-in fields:** `journey` and `responseChannel` are NOT documented in the API spec and are not emitted by default. If your specific NF deployment requires them, pass them explicitly — they will be sent verbatim. The library's default behavior conforms to the published Field Reference; deviation from the spec is opt-in only.

### Default field set

Each field is resolved by `[name="<key>"]` first, then by `.<LegacyClass>` if no `name=` match. The preset auto-detects which fields are present on the page and only validates the ones that exist. The "Wire field" column shows what (if anything) lands in the outgoing payload.

**Required (always emit / always validate when present):**

| Form key (`name=`) | Legacy class | Wire field | Default validator |
|---|---|---|---|
| `fullName` | `.FullName` | `fullName` | `required` + `fullNameLettersOnly` |
| `firstName` / `lastName` | `.FirstName` / `.LastName` | combined into `fullName` | `required` + `lettersHyphenSpaces` |
| `email` | `.Email` | `email` | `required` + `emailStrict` |
| `phone` | `.Phone` | `phone` (digits only) | `required` + `phoneUS` (live-formatted) |
| `consent` | `.PrivacyPolicyAccepted` | `consent` (boolean) | `mustAccept` |

**Personal Information (auto-skip when input absent):**

| Form key (`name=`) | Legacy class | Wire field | Default validator |
|---|---|---|---|
| `zipCode` | `.ZipCode` | `zipCode` | `required` + `zipUS` (live-formatted) |

**Business Information (auto-skip when input absent — XPRS forms typically use these):**

| Form key (`name=`) | Legacy class | Wire field | Default validator |
|---|---|---|---|
| `businessName` | `.BusinessName` | `businessName` | `required` + `minLength(2)` + `maxLength(100)` |
| `businessStreetAddress` | `.BusinessStreetAddress` | `businessStreetAddress` | `required` |
| `businessCity` | `.BusinessCity` | `businessCity` | `required` |
| `businessState` | `.BusinessState` | `businessState` | `required` + `usState` |
| `businessZipCode` | `.BusinessZipCode` | `businessZipCode` | `required` + `zipUS` (live-formatted) |
| `entityType` | `.EntityType` | `entityType` | `requiredSelect` + `oneOf(ENTITY_TYPES)` |
| `industry` | `.Industry` | `industry` | `requiredSelect` + `oneOf(INDUSTRIES)` |

**Financial Information (auto-skip when input absent — NFCoreApply forms typically use this):**

| Form key (`name=`) | Legacy class | Wire field | Default validator |
|---|---|---|---|
| `annualRevenueRange` (legacy `salesDistributionTier` accepted) | `.SalesDistributionTier` | `annualRevenueRange` | `requiredSelect` + `oneOf(ANNUAL_REVENUE_RANGES)` |

The preset uses `fullName` if present; otherwise it falls back to `firstName` + `lastName`, joining them with a space before shipping. `firstName` and `lastName` never appear in the wire payload.

**Annual sales `<select>` option values must be valid API enum strings.** Each `<option value>` is shipped verbatim as `annualRevenueRange`, and the validator rejects anything else at the form layer (so a typo surfaces in dev, not as a 400 from the gateway):

| Label (visible to user) | Recommended option value (API enum) |
|---|---|
| Under $120K | `Under $120K` |
| $120K-$249K | `$120K-$249K` |
| $250K-$499K | `$250K-$499K` |
| $500K-$999K | `$500K-$999K` |
| Over $1M | `Over $1M` |

For pages still authored with prod's legacy Tier codes (`Tier 1a` / `Tier 1b` / `Tier 2a` / `Tier 2b` / `Tier 3`), opt the `tierMapPlugin` back into the chain explicitly — it converts Tier codes to API enum values. The preset doesn't include it by default; the goal is for the form to produce the API value directly.

**Authoring in Framer (recommended):** select each input on the canvas → right panel → set the **Name** property to the form key from the table above (`fullName`, `email`, `phone`, `annualRevenueRange`, `consent`). No Code Override needed.

**Legacy class wiring (existing prod pages):** add the corresponding class via a Code Override — `withFullName`, `withEmail`, etc. — that appends the class to the element's `className`. Continues to work unchanged.

**Diagnostic:** if the form mounts and a required field is reachable by neither `name=` nor its legacy class, the preset logs a single `console.warn` listing what's missing and how to wire it. Suppress with `{ quiet: true }`.

### When to skip the preset

The preset is for the common Fairsquare/National-Funding pattern. If you need fields it doesn't know about (custom partner code, multi-step flow, hidden flags), use `createForm` directly — see the [low-level API](#low-level-api-createform) below. The preset and `createForm` are complementary; the preset *is* a `createForm` call with sensible defaults.

Working examples: [`example-iife.html`](./example-iife.html) (drop-in), [`example.html`](./example.html) (ESM).

---

## Low-level API: `createForm`

The preset is built on top of `createForm`. Use it directly when you need full control:

```js
const { createForm, validators, formatters, plugins } = FairsquareForm;
const { all, required, emailStrict, phoneUS, fullNameLettersOnly, mustAccept, requiredSelect } = validators;
const { formatPhoneUS, stripDashes } = formatters;

const get = (name) => () => {
  const el = document.querySelector(`[data-form="apply"] [name="${name}"]`);
  if (!el) return "";
  if (el.type === "checkbox") return el.checked ? "on" : "";
  return el.value || "";
};

createForm({
  id: "apply",
  endpoint: "https://www.nationalfunding.com/api/forms/submit",
  fields: {
    fullName: { get: get("fullName"), validate: all(required(), fullNameLettersOnly()) },
    email:    { get: get("email"),    validate: all(required(), emailStrict()) },
    phone:    { get: get("phone"),    validate: all(required(), phoneUS()), format: formatPhoneUS },
    consent:  { get: get("consent"),  validate: all(mustAccept()) },
  },
  plugins: [
    plugins.attribution(),
    plugins.queryParams(),
    plugins.staticFields({ source: "NF", formType: "your-formType" }),
    plugins.submitButton(),
    plugins.serverValidation(),
    plugins.redirectOnUrl(),
  ],
  onSubmit(values) {
    return {
      fullName: values.fullName,
      email: values.email,
      phone: stripDashes(values.phone),
      consent: values.consent === "on",
    };
  },
});
```

---

## Concepts

### Submission lifecycle

```
1. mount()                       — wait for the form node (Framer/Webflow safe)
2. validateAll()                 — run every field's validator
   ↳ on failure: onValidationFail plugins fire, return early
3. onSubmit(values)              — consumer maps form values → API payload (sync or async)
4. enrich(payload, ctx)          — plugins augment the payload (NFID, query params, tier mapping,
                                    fbclid resync, etc.) — awaited in registration order
5. onBeforeSend(payload, ctx)    — last-mile side effects (e.g. submit-button spinner start)
6. transport.send(payload, ctx)  — POST JSON, parse response, throw TransportError on non-2xx
7. onAfterSend({ ok, res|err })  — paired with onBeforeSend (spinner stop)
8. onSuccess(res, ctx) | onError(err, ctx)
                                  — plugins run in registration order, awaited;
                                    consumer's onSuccess/onError runs last
```

Plugins registered earlier in the array can block plugins registered later. This matters most for `dataLayerPlugin`: register it **before** `redirectOnUrlPlugin` so the GA hit gets a tick to fire before navigation.

### Field config

```ts
type FieldConfig = {
  get: () => unknown,                       // read the field's current value
  validate: (value, allValues) => Promise<{ valid: boolean, message: string }>,
  format?: (raw: string) => string,         // optional live formatter, bound to `input` event
};
```

`get` reads from the DOM (or wherever); the lib doesn't assume a specific input element type. For checkboxes, return `"on"` / `""`. For selects, return the `value` attribute (or the label — your call).

### Response shape

The Lead Gateway returns the same envelope on every response:

```ts
type Response = {
  success: boolean,
  url?: string,            // 200: where to redirect; 4xx/5xx: fallback web form
  message?: string,
  fields?: string[],       // 400: which fields failed validation
  missingFields?: string[], // 400: which required fields were absent
};
```

| Status | What it means | What `redirectOnUrlPlugin` does (defaults) |
|---|---|---|
| 200 | Lead accepted | Redirect to `res.url` |
| 400 with `fields[]` | Validation failed | **Stay on form** so inline errors show |
| 400 with `missingFields[]` | Workflow needs more data | Redirect to fallback `url` if present |
| 500 | Server error | Redirect to fallback `url` if present |
| 401 | Token expired (partner endpoint only) | n/a — whitelisted endpoint doesn't auth |

`TransportError` carries `{ status, body, url, message }` so plugins can branch on the shape themselves.

---

## Validators

All validators are factory functions returning `(value, allValues) => Promise<{ valid, message }>`. Compose with `all()` (logical AND, returns first failure) or `any()` (logical OR).

| Validator | Behavior |
|---|---|
| `required(msg?)` | Non-empty after trim |
| `email(msg?)` | Loose email regex |
| `emailStrict(msg?)` | Multi-label domain, rejects `..` and duplicate trailing labels (`foo@bar.com.com`) |
| `phoneBasic(msg?)` | Permissive `+?[0-9\s\-()]{7,20}` |
| `phoneDashedUS(msg?)` | Strict `###-###-####` |
| `phoneUS(msg?)` | 10-digit US, area code 2–9, `-` or space separators |
| `zipUS(msg?)` | 5-digit US ZIP, range `[501, 99950]`, rejects all-zeros |
| `lettersHyphenSpaces(msg?)` | Letters with optional hyphens and spaces |
| `fullName(msg?)` | Loose: ≥2 space-separated words |
| `fullNameLettersOnly(msg?)` | Strict: letters only, ≥2 words |
| `minLength(n, msg?)` / `maxLength(n, msg?)` | Length bounds |
| `pattern(re, msg?)` | Custom regex |
| `requiredSelect(msg?)` | Non-empty (for `<select>`) |
| `mustAccept(msg?)` | Boolean true / `"on"` / `"true"` / `"1"` / `"yes"` |
| `oneOf(allowed[], msg?)` | Membership check (pair with frozen enums) |
| `all(...validators)` / `any(...validators)` | Composition |

---

## Formatters

Pure `(raw: string) => string`. Set as `field.format` to bind on the `input` event.

| Formatter | Behavior |
|---|---|
| `formatPhoneUS` | Strips non-digits, caps at 10, emits `###-###-####` |
| `formatZipUS` | Strips non-digits, caps at 5 |
| `stripDashes` | Removes `-` (useful when serializing for transport) |

---

## Plugins

Each plugin is a factory returning `{ init?, enrich?, onBeforeSend?, onAfterSend?, onSuccess?, onError?, onValidationFail? }`. All hooks are optional and may be `async`.

### `attributionPlugin(options?)`

Adds spec-documented attribution fields to the payload via `init` (wraps `onSubmit`).

| Field | Source | Toggle | Default |
|---|---|---|---|
| `trackingId` | `_ga` cookie | `includeTrackingId` | on |
| `landingPage` | `window.location.href` | `includeLandingPage` | on |
| `referrer` | `document.referrer` | `includeReferrer` | on |
| `clientBrowser` | `navigator.userAgent` | `includeClientBrowser` | on |
| `nfid` | crypto-strong UUID, persisted in cookie | `includeNfid` | **off** (not in API spec) |
| `path` | URL minus query/hash | `includePath` | **off** (not in API spec) |

The plugin still generates and persists the NFID cookie regardless of the `includeNfid` flag, and exposes it on `ctx.clientId` so downstream plugins (e.g., the dataLayerPlugin) can reference it. The flag only controls whether it lands in the wire payload.

Options: `clientId` (forwarded to `getOrCreateClientId`: `cookieName`, `persistDays`, `sameSite`, `secure`, `domain`, `canSetCookie`); `gaCookieName` (default `_ga`); `fields` (rename payload keys).

### `queryParamsPlugin(options?)`

Captures URL query-string params, writes them to the payload using canonical NF field names.

Default mapping (every entry corresponds to a documented Tracking and Attribution field): `utm_source→utmSource`, `utm_medium→utmMedium`, `utm_campaign→utmCampaign`, `utm_content→utmContent`, `utm_term→utmTerm`, `utm_id→utmId`, `gclid`, `fbclid`, `msclkid`.

Note: `gclsrc` (Google click source) is **not** in the default map — it's not in the API spec. Opt-in via `extraMap: { gclsrc: "gclsrc" }`.

Options: `map` (replace defaults), `extraMap` (extend), `useDefaults`, `namespace` (nest under a key, e.g. `attribution.utmSource`).

### `tierMapPlugin(options?)`

Migration helper for pages whose dropdowns still use prod's legacy Tier codes (`"Tier 2a"`) as `<option value>`s. **Not included in the framer preset's default chain as of v0.3.1** — the recommended authoring is to put the API enum string directly into the option value, in which case no plugin is needed.

When opted in, the plugin reads a value from the form (default field `salesDistributionTier`) and resolves it either way:
- Form value matches a documented `annualRevenueRange` enum (e.g., `"$500K-$999K"`) → emit verbatim
- Form value is a legacy Tier code (e.g., `"Tier 2b"`) → look up via `enums.TIER_TO_REVENUE_RANGE` → emit the corresponding enum

Options: `sourceField` (input form key, default `"salesDistributionTier"`), `tierField` (legacy parity output key, default `null` — set to a string to also emit a tier code), `revenueRangeField` (default `"annualRevenueRange"`), `group` (default true; emits grouped `Tier 2` instead of `Tier 2a` when `tierField` is set).

Use this only as a one-time migration helper while you update legacy `<option value>` strings to the API enum.

### `staticFieldsPlugin(statics, options?)`

Declarative per-form statics merged into the payload via `enrich`.

```js
plugins.staticFields({
  source: "NF",                  // spec-required; always "NF"
  formType: "your-formType",     // spec-required; case-sensitive, assigned at onboarding
});
```

`journey` and `responseChannel` are not in the published API spec. If your specific NF deployment requires them, you can pass them here — they'll be sent verbatim — but the documented field reference does not list them.

Options: `mode` (`"override"` default, `"fill"` only sets keys not already present). Null/undefined entries are stripped so a missing config can't blank a real value.

### `fbclidResyncPlugin(options?)`

Async-enrichment plugin that ports the prod script's `updateFbclidInUrlFromCookie` behavior:

- URL has no `?fbclid=…`? → no-op, zero added latency
- URL has `fbclid`? → poll `_fbp` cookie up to `maxWaitMs` (default 3000ms, 150ms ticks)
- On the first non-empty cookie read, replace the `fbclid` URL param value with the cookie value and write the resulting URL into the payload's `landingPage` (overriding `attributionPlugin`'s value)
- On poll timeout, leave the field as-is

Options: `cookieName` (default `_fbp`), `urlParam` (default `fbclid`), `field` (default `landingPage`), `maxWaitMs`, `pollIntervalMs`, `getHref` (test hook).

### `dataLayerPlugin(config)`

GTM-style event push with reliable delivery before the redirect navigation.

```js
plugins.dataLayer({
  event: "gaEvent",                    // static (default)
  eventCategory: "forms",              // static (default)
  eventAction: "submission",           // static (default)
  form_type: "large_stand_alone_apply_now",  // per-form
  fireOn: "success",                   // 'submit' | 'success' | 'both'
  alsoFireOnError: true,               // fires gaEventError on failure
  reliability: "auto",                 // 'auto' | 'eventCallback' | 'microtask' | 'delay' | 'none'
  reliabilityTimeoutMs: 300,
  params: {
    event_tier: { source: "form",     name: "annualRevenueRange" },                // raw value
    tierDetail: { source: "form",     name: "annualRevenueRange", as: "label" },   // <option>.text
    zip_code:   { source: "form",     name: "zipCode", default: "" },
    event_card: { source: "response", path: "event_card", default: "no card submitted" },
    state:      { source: "response", path: "state", default: "" },
  },
});
```

**Source kinds** (in `params`):
- `{ source: "static", value }` or just a string literal
- `{ source: "form", name, as?: "label", default? }` — value or `<option>.text` for `<select>`
- `{ source: "response", path, default? }` — dotted path into the Lead Gateway response
- `(values, response, ctx) => string` — function shorthand

**Reliability strategies** (the trade-off between GA hit delivery and redirect latency):

| Mode | Delay | When to use |
|---|---|---|
| `microtask` | sub-millisecond | Pure GTM (no `gtag`); two microtask drains let GTM trigger sendBeacon |
| `eventCallback` | 0–`reliabilityTimeoutMs` | `window.gtag` is on-page; explicit ack from GA |
| `auto` (default) | one of the above | Detects `gtag` |
| `delay` / `none` | escape hatches | |

Register **before** `redirectOnUrlPlugin` so the redirect awaits the dataLayer hook.

### `submitButtonPlugin(options?)`

Injects a CSS spinner into the form's submit button while the request is in flight; sets `aria-busy`; hides any leading SVG/icon for the duration.

Options: `iconSelector` (default `"svg"`), `injectStyles` (default true; opt out if the host page provides styles).

### `redirectOnUrlPlugin(options?)`

Implements the Lead Gateway redirect contract:

| Status | Action |
|---|---|
| 200 with `res.url` | Redirect (toggle: `onSuccess`, default true) |
| 400 with `missingFields[]` and `url` | Redirect (toggle: `onMissingFields`, default true) |
| 500 with `url` | Redirect (toggle: `onServerError`, default true) |
| 400 with `fields[]` and `url` | **Don't** redirect (toggle: `onValidationError`, default false) |

Rejects non-`http(s):` URLs (no `javascript:` redirect). Optional `transformUrl` (last-mile rewrite) and `navigate` (override the side-effect).

### `serverValidationPlugin(options?)`

Surfaces a 400 with `fields[]` onto the matching form fields via `controller.setFieldErrors()`. Pair with `redirectOnUrlPlugin`: that one handles missing-field/server-error redirects, this one keeps users on the form when their inputs need fixing.

Options: `messages` (API field → user-facing message map), `fieldNameMap` (API → form field name when they differ), `fallbackMessage`.

---

## Plugin authoring

Write plugins as factory functions returning a hook bag:

```js
export const myPlugin = (options = {}) => ({
  init(ctx) {
    // setup; runs once on controller construction.
    // Wrap ctx.onSubmit here for synchronous payload transformation.
  },

  async enrich(payload, ctx) {
    // Async payload transformation. Returns the next payload, or
    // null/undefined to leave it unchanged. Awaited in registration order.
    return { ...payload, myField: "value" };
  },

  async onBeforeSend(payload, ctx) {
    // Side effects right before transport.send.
  },

  async onAfterSend({ ok, res, err }, ctx) {
    // Paired with onBeforeSend. Fires on both success and failure.
  },

  async onSuccess(res, ctx) {
    // Controller awaits this in registration order — earlier plugins
    // can block later ones (e.g., dataLayer gating redirect).
  },

  async onError(err, ctx) {
    // err is a TransportError or whatever transport.send threw.
  },

  onValidationFail(errors, ctx) {
    // Local validation failed. errors is { fieldName: message }.
  },
});
```

`ctx` is the `FormController` instance. Useful methods/properties:

| Property / method | Purpose |
|---|---|
| `ctx.id` | Form id |
| `ctx.formSelector` | `[data-form="…"]` selector |
| `ctx.getValues()` | Map of current form values |
| `ctx.setFieldError(name, msg)` / `setFieldErrors({…})` | Surface server-side errors |
| `ctx.clearFieldError(name)` / `clearAllErrors()` | Clear errors |
| `ctx.transport`, `ctx.dom`, `ctx.plugins` | Adapters / siblings |

**Choosing a hook:**

| What you're doing | Use |
|---|---|
| One-time setup, listening for events on the form | `init` |
| Synchronous payload mapping (cookie reads, statics) | `init` (wrap `ctx.onSubmit`) |
| Async payload mapping (network, polling) | `enrich` |
| Start a UI side effect at submit time | `onBeforeSend` |
| End a UI side effect after the network call | `onAfterSend` |
| React to the parsed Lead Gateway response | `onSuccess` |
| React to a `TransportError` | `onError` |
| Block a later plugin (e.g., the redirect) | Return a promise from `onSuccess` |

---

## Lead Gateway integration

The lib targets the National Funding Lead Gateway response shape. Two endpoints, same shape:

- `POST /api/forms/submit` — whitelisted (origin allowlist + CORS), used by public landing pages. **No client_secret in the bundle.**
- `POST /api/partners/submit` — OAuth Bearer, partner integrations. Out of scope for browser-deployed forms (would expose the secret).

**Routing is server-side.** The integration guide is explicit that the gateway dispatches based on `formType`. The lib follows that — `formType` is static config the developer sets at onboarding.

| Field | Notes |
|---|---|
| `source` | Always `"NF"` (spec-required) |
| `formType` | Assigned at partner onboarding, **case-sensitive**; determines validation schema and workflow (spec-required) |
| `journey` | NOT in published API spec. Some deployments may consume it for routing — pass via `staticFieldsPlugin` only if your partner contact has confirmed in writing that it's required. |
| `responseChannel` | NOT in published API spec. Same caveat as `journey`. |

Configure spec-required statics (`source`, `formType`) via `staticFieldsPlugin`. The two non-spec fields are opt-in only.

**Idempotency**: the API explicitly does not deduplicate (per the troubleshooting section of the integration guide). The transport supports an `idempotencyKey` getter — use the persisted NFID:

```js
plugins.attribution({ /* sets ctx.clientId */ }),
// …
transport: mkTransport(endpoint, {
  idempotencyKey: (_payload, ctx) => ctx.clientId,
}),
```

---

## Security & privacy

- **No `client_secret` is ever embedded in the bundle.** This lib is for whitelisted public endpoints only. If you need OAuth-authenticated submission, do it server-side and call this lib through a relay.
- **Cookies default to `SameSite=Lax`, `Secure` on HTTPS.** `attributionPlugin`/`getOrCreateClientId` accept a `canSetCookie` callback so you can gate cookie writes behind a consent banner.
- **`credentials: 'omit'`** on every transport request — first-party cookies don't leak to the gateway origin.
- **Inline error rendering uses `textContent`** — server-supplied error strings can't escape into markup.
- **`redirectOnUrlPlugin` rejects non-`http(s):` URLs**, including `javascript:` payloads in the `url` field.
- **Validators run client-side for UX only.** Server-side validation is authoritative; `serverValidationPlugin` surfaces a 400 with `fields[]` back to the user.

What gets sent on a typical submit (every field below is documented in the API Field Reference):

```
fullName, email, phone, businessName, zipCode, consent
trackingId (_ga cookie), landingPage, referrer, clientBrowser
utmSource, utmMedium, utmCampaign, utmContent, utmTerm, utmId
gclid, fbclid, msclkid
annualRevenueRange (form key matches API field 1:1)
source, formType
```

Internal-only data the library uses but does NOT ship: the NFID cookie value (used as `idempotencyKey` and for dataLayer events; toggleable to wire via `attributionPlugin({ includeNfid: true })`), and the form keys `firstName` / `lastName` (combined into `fullName` before submission).

---

## Build & deploy

```bash
npm install
npm test           # 246 tests in vitest + jsdom
npm run build      # emits dist/ (4 bundles)
npm run build:watch
```

`npm run build` produces:

| File | Use |
|---|---|
| `dist/fairsquare-form.iife.min.js` | Production drop-in (`<script src>`, `window.FairsquareForm`) |
| `dist/fairsquare-form.iife.js` (+ `.map`) | IIFE with sourcemap for debugging |
| `dist/fairsquare-form.esm.min.js` | Minified ESM |
| `dist/fairsquare-form.esm.js` (+ `.map`) | ESM with sourcemap |

**Deploy via jsDelivr GH:** tag a release, then point Framer/Webflow at:

```
https://cdn.jsdelivr.net/gh/jhilton-fairsquare/fairsquare-libform@v0.3.2/dist/fairsquare-form.iife.min.js
```

If a deployed page is loading an older tag and a fresh build hasn't propagated yet, you can force jsDelivr to refresh once with `https://purge.jsdelivr.net/gh/jhilton-fairsquare/fairsquare-libform@<tag>/dist/fairsquare-form.iife.min.js` (one-time hit, then cache resumes).

`dist/` is tracked in git so the file is immediately available at any commit/tag — no separate publish pipeline. After every source change, regenerate (`npm run build`) and commit `dist/` alongside the source. A CI check that runs `npm run build && git diff --exit-code dist/` will catch drift.

---

## Browser support

ES2020 target. Concretely: any browser released after 2020 (Chromium-based, modern Firefox, modern Safari). Framer and Webflow consumer runtimes are well within that window. Drop the build target to `es2017` if you ever need to support older browsers — esbuild will handle the downlevel.

---

## Changelog

### v0.3.2 (current)
- Added Business Information fields to the framer preset's `DEFAULT_FIELDS`: `businessStreetAddress`, `businessCity`, `businessState`, `businessZipCode`, `entityType`, `industry`. Each auto-skips when its input isn't on the form, so existing NFCoreApply pages are unaffected.
- New `usState()` validator (case-insensitive 2-letter US state code, 50 states + DC).
- Loosened `businessName` validator to spec — now `minLength(2) + maxLength(100)` instead of letters-only. Accepts "Framer's Frames", "AT&T", "3M".
- Mount diagnostic tightened: stopped warning about `annualRevenueRange` since XPRSApply forms legitimately omit it. Required-core is now email + phone + consent + name pair.

### v0.3.1
- Renamed form-field key `salesDistributionTier` → `annualRevenueRange` so it matches the API field 1:1. Form value now goes straight to the wire; option values must be the documented enum (`"$500K-$999K"` etc.). Validator: `requiredSelect + oneOf(ANNUAL_REVENUE_RANGES)`.
- `tierMapPlugin` removed from the framer preset's default plugin chain. Kept as an opt-in migration helper for pages whose dropdowns still use legacy "Tier 2b"-style option values.
- `DEFAULT_FIELDS` entries support an `altNames: [...]` list for back-compat name= matching. The new `annualRevenueRange` field accepts `name="salesDistributionTier"` as an alt for pages already wired with the previous key.
- `oneOf` re-exported from the validators namespace (`V.oneOf`).

### v0.3.0
- Wire-payload audit against the published API spec. Out-of-spec fields no longer emitted by default: `salesDistributionTier`, `nfid`, `path`, `firstName`/`lastName` as separate fields (combined into `fullName` per spec), `gclsrc`, `responseChannel` (no default). Each has an opt-in escape hatch.
- `tierMapPlugin` accepts the API enum string directly as the form value (in addition to legacy Tier codes).

### v0.2.0
- Field resolution: `[name="<key>"]` primary, `.<LegacyClass>` fallback. Framer's right-panel **Name** property now sets a working integration with no Code Override required.
- Mount-time `console.warn` lists missing required fields with both the `name=` and the legacy class to add. Suppress with `{ quiet: true }`.

### v0.1.x
- Initial extraction from `script.js`. Plugin pipeline, validator catalog, transport with idempotency + timeouts, GA dataLayer with reliable delivery, fbclid/_fbp resync, FormController with name=-based field discovery, mount + watchReplacement.

---

## Migration from the prod `script.js`

The prod IIFE (`script.js`) and this lib do the same things; the lib does them in smaller, testable, configurable pieces.

| Prod behavior | Lib equivalent |
|---|---|
| `CookieManager` + auto eTLD+1 domain | `utils/cookies.js` (call site sets `domain`) |
| `generateNFID` + `_nfIdSF` cookie | `utils/id.js` + `attributionPlugin` (`Math.random` → `crypto.getRandomValues`) |
| `updateFbclidInUrlFromCookie` | `fbclidResyncPlugin` |
| `validateInputs` regexes | `validators` catalog (subdomain bug fixed) |
| Phone/ZIP live formatting | `formatters` |
| `setButtonLoading` | `submitButtonPlugin` |
| `tierToRevenue` table + tier grouping | `enums.TIER_TO_REVENUE_RANGE` + `tierMapPlugin` (v0.3.1+: opt-in migration helper only — recommended authoring puts the API enum string directly in the option value) |
| `dataLayer.push({event: "gaEvent", …})` | `dataLayerPlugin` (with reliable delivery + no lookup tables) |
| `fieldMap` with `{ static: … }` | `staticFieldsPlugin` |
| `optionalFields` query-param capture | `queryParamsPlugin` |
| `MutationObserver` + form ready | `mount()` (with optional `watchReplacement`) |
| Document-level click delegation | Form `submit` event (rebinds via `watchReplacement` if Framer hot-swaps) |
| `window.location.href = res.url` on success | `redirectOnUrlPlugin` (now handles 4xx/5xx fallback URLs too) |

Differences worth knowing:

- **Spec-conformant wire payload (v0.3.0+)**. Out-of-spec fields prod's script.js shipped — `salesDistributionTier`, `nfid`, `path`, separate `firstName`/`lastName`, `gclsrc` — are no longer emitted. The form-field key for the revenue dropdown is `annualRevenueRange`, matching the API field 1:1; the option value is shipped verbatim. NFID is still generated and persisted as a cookie (used for idempotency and dataLayer events) but stays inside the library. Each removed field has an opt-in flag if a deployment really needs it.
- **`businessName` validator loosened (v0.3.2)**. Prod's `lettersHyphenSpaces` regex rejected legitimate names like "Framer's Frames", "AT&T", "3M". Now `minLength(2) + maxLength(100)` matching the spec.
- **Email validator** accepts multi-label domains (`user@mail.fairsquare.com`). Prod's regex rejected them — a real latent bug.
- **`tierDetail`** in the GA event reads `<option>.text` directly instead of looking up the prod `tierToRevenue` table. Same value, no mapping table on the client.
- **Submission errors fire a `gaEventError`** in the dataLayer so you can measure failure rates — prod fires the success event regardless of outcome.
- **Failed submits don't redirect** by default (validation 400 keeps the user on the form). Prod's flow had no failure path UI; this is an improvement.

---

## Testing

```bash
npm test           # all 246 tests
npm test -- tests/transport.test.js
npm run test:coverage
```

Tests cover:

| File | Tests | What |
|---|---|---|
| `validators.test.js` | 81 | Every validator, valid + invalid + composition |
| `transport.test.js` | 12 | Every Lead Gateway response shape, timeout, idempotency |
| `plugins.test.js` | 40 | tierMap (legacy + direct enum paths), queryParams, attribution (spec defaults + opt-ins), staticFields, redirectOnUrl, serverValidation |
| `framer-preset.test.js` | 30 | name=/class resolution, business-information cluster, mount diagnostic, FirstName/LastName combine |
| `dataLayer.test.js` | 22 | Source resolution, fireOn modes, every reliability strategy, dataLayer→redirect ordering |
| `fbclidResync.test.js` | 11 | Enrich shape, immediate/retry/timeout, custom config, controller integration |
| `controller.test.js` | 8 | Mount, submit happy path, error path, setFieldErrors |
| `mount.test.js` | 6 | waitForElement immediate/late/timeout, mount + watchReplacement |
| `formatters.test.js` | 9 | formatPhoneUS, formatZipUS, stripDashes |
| `enums.test.js` | 18 | All enums frozen, tier table verbatim, oneOf |

The build pipeline is intentionally not in the test suite — tests run against source, the build is downstream packaging. Add `npm run build && git diff --exit-code dist/` to CI to enforce parity.

---

## Open questions / known gaps

- **Endpoint mismatch with the published spec.** The integration guide documents `POST /api/partners/submit` (Bearer-authenticated), but this lib targets `POST /api/forms/submit` (origin-allowlisted, no client_secret). Both work today; worth confirming with the NF team that `forms/submit` is a sanctioned public-page endpoint and not a deprecated alias.
- **`journey` and `responseChannel` are not in the API spec.** Some deployments accept them; the lib treats them as opt-in non-spec fields. If your partner contact confirms either is required by your specific deployment, ask for the spec to be updated.
- **No CI yet.** The recommended setup: GitHub Actions running `npm test` + `npm run build` + `git diff --exit-code dist/` on every PR.
- **No JSDoc `@typedef`s for the public API surface.** Adding them would give consuming codebases IDE support without a TS migration.

> **Note:** `"Framer"` is a real registered `formType` value, not a placeholder. Use it verbatim for Framer-deployed Fairsquare landing pages.
