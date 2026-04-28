# fairsquare-libform

A small, extensible form-handling library for Fairsquare lead-capture pages. Validates user input, normalizes it for the National Funding Lead Gateway API, attaches attribution data, fires GA dataLayer events without losing them to navigation races, and redirects the applicant to the URL the gateway returns.

Drop-in via `<script src>` for Framer/Webflow, or import as ESM in a build pipeline.

- Zero runtime dependencies, ~23 KB minified IIFE bundle
- 196 tests covering validators, transport, plugin pipeline, controller integration, build artifacts
- Plugin lifecycle: `init → enrich → onBeforeSend → transport → onAfterSend → onSuccess|onError`
- Structured response handling for the Lead Gateway shape (`{ success, url, fields[], missingFields[] }`)
- AbortController timeouts, optional `Idempotency-Key`, `credentials: 'omit'` by default

---

## Install

### Framer / Webflow / plain HTML (IIFE drop-in)

```html
<script src="https://cdn.jsdelivr.net/gh/jhilton-fairsquare/fairsquare-libform@v0.1.0/dist/fairsquare-form.iife.min.js"></script>
<script>
  const { createForm, validators, formatters, plugins } = FairsquareForm;
  // …configure as below
</script>
```

Pin to a tag in production. To roll out a change: edit source, `npm run build`, commit (source + dist together), tag, update the URL in Framer.

### npm / build pipeline (ESM)

```bash
npm install github:jhilton-fairsquare/fairsquare-libform#v0.1.0
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

## Quick start

```html
<form data-form="apply" novalidate>
  <input name="fullName" />
  <input name="email" type="email" />
  <input name="phone" />
  <select name="salesDistributionTier">
    <option value="">Annual revenue…</option>
    <option value="Tier 1a">Under $120K</option>
    <option value="Tier 1b">$120K&ndash;$249K</option>
    <option value="Tier 2a">$250K&ndash;$499K</option>
    <option value="Tier 2b">$500K&ndash;$999K</option>
    <option value="Tier 3">Over $1M</option>
  </select>
  <label><input name="consent" type="checkbox" value="on" /> Accept privacy policy</label>
  <button type="submit">Apply Now</button>
</form>

<script>
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
      fullName:              { get: get("fullName"),              validate: all(required(), fullNameLettersOnly()) },
      email:                 { get: get("email"),                 validate: all(required(), emailStrict()) },
      phone:                 { get: get("phone"),                 validate: all(required(), phoneUS()), format: formatPhoneUS },
      salesDistributionTier: { get: get("salesDistributionTier"), validate: all(requiredSelect()) },
      consent:               { get: get("consent"),               validate: all(mustAccept()) },
    },
    plugins: [
      plugins.attribution(),                  // NFID + _ga + landingPage + path + referrer + clientBrowser
      plugins.queryParams(),                  // utmSource/Medium/Campaign/…, gclid, gclsrc, fbclid, msclkid
      plugins.tierMap(),                      // tier code → annualRevenueRange enum
      plugins.staticFields({                  // routing-critical statics
        source: "NF",
        formType: "your-formType",            // assigned by partner team — case-sensitive
        journey: "NFCoreApply",
        responseChannel: "Internet",
      }),
      plugins.fbclidResync(),                 // _fbp resync into landingPage
      plugins.submitButton(),                 // spinner + aria-busy
      plugins.serverValidation(),             // surface 400 fields[] on form
      plugins.dataLayer({                     // GA event with reliable delivery
        form_type: "large_stand_alone_apply_now",
        params: {
          event_tier: { source: "form",     name: "salesDistributionTier" },
          tierDetail: { source: "form",     name: "salesDistributionTier", as: "label" },
          zip_code:   { source: "form",     name: "zipCode", default: "" },
          event_card: { source: "response", path: "event_card", default: "no card submitted" },
          state:      { source: "response", path: "state", default: "" },
        },
      }),
      plugins.redirectOnUrl(),                // 200 res.url + 4xx/5xx fallback url
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
</script>
```

Working examples live at [`example.html`](./example.html) (ESM) and [`example-iife.html`](./example-iife.html) (drop-in).

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

Adds attribution fields to the payload via `init` (wraps `onSubmit`).

| Field | Source | Toggle |
|---|---|---|
| `nfid` | crypto-strong UUID, persisted in cookie (default `nfid`) | `includeNfid` |
| `trackingId` | `_ga` cookie | `includeTrackingId` |
| `landingPage` | `window.location.href` | `includeLandingPage` |
| `path` | URL minus query/hash | `includePath` |
| `referrer` | `document.referrer` | `includeReferrer` |
| `clientBrowser` | `navigator.userAgent` | `includeClientBrowser` |

Options: `clientId` (forwarded to `getOrCreateClientId`: `cookieName`, `persistDays`, `sameSite`, `secure`, `domain`, `canSetCookie`); `gaCookieName` (default `_ga`); `fields` (rename payload keys).

### `queryParamsPlugin(options?)`

Captures URL query-string params, writes them to the payload using canonical NF field names.

Default mapping: `utm_source→utmSource`, `utm_medium→utmMedium`, `utm_campaign→utmCampaign`, `utm_content→utmContent`, `utm_term→utmTerm`, `utm_id→utmId`, `gclid`, `gclsrc`, `fbclid`, `msclkid`.

Options: `map` (replace defaults), `extraMap` (extend), `useDefaults`, `namespace` (nest under a key, e.g. `attribution.utmSource`).

### `tierMapPlugin(options?)`

Reads a tier code from the payload (default field `salesDistributionTier`) and writes:
- `salesDistributionTier`: grouped tier (`Tier 2a/2b → Tier 2`)
- `annualRevenueRange`: human-readable enum (e.g., `"$250K-$499K"`) per the table in `enums.TIER_TO_REVENUE_RANGE`

No client-side lookup objects required by consumers — the table is internal to the plugin.

Options: `sourceField`, `tierField` (output), `revenueRangeField` (output), `group` (default true).

### `staticFieldsPlugin(statics, options?)`

Declarative per-form statics merged into the payload via `enrich`. The parity equivalent of prod's `{ static: "value" }` pattern.

```js
plugins.staticFields({
  source: "NF",
  formType: "your-formType",     // case-sensitive, assigned at onboarding
  journey: "NFCoreApply",        // change to "XPRSApply" for an XPRS form
  responseChannel: "Internet",
});
```

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
    event_tier: { source: "form",     name: "salesDistributionTier" },                // raw value
    tierDetail: { source: "form",     name: "salesDistributionTier", as: "label" },   // <option>.text
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

**Routing is server-side.** The migration appendix in the v1.0 implementation guide is explicit: "Remove any client-side routing logic (the gateway handles this)." The lib follows that — `formType` and `journey` are static config the developer sets; the gateway dispatches based on those values.

| Field | Notes |
|---|---|
| `source` | Always `"NF"` |
| `formType` | Assigned at partner onboarding, **case-sensitive**; determines the validation schema AND the workflow |
| `journey` | Routing parameter (e.g., `"NFCoreApply"`, `"XPRSApply"`); used for conditional validation (`annualRevenueRange` is required for `NFCoreApply`) |
| `responseChannel` | Enum: `"Internet"` or `"Internet-PURL"` |

Configure all four via `staticFieldsPlugin`. To switch a form's journey, change one line.

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

What gets sent on a typical submit (with the example plugins enabled):

```
fullName, email, phone, businessName, zipCode, consent
nfid (cookie-backed), trackingId (_ga cookie)
landingPage, path, referrer, clientBrowser (navigator.userAgent)
utmSource, utmMedium, utmCampaign, utmContent, utmTerm, utmId
gclid, gclsrc, fbclid, msclkid
salesDistributionTier (grouped), annualRevenueRange
source, formType, journey, responseChannel
```

---

## Build & deploy

```bash
npm install
npm test           # 196 tests in vitest + jsdom
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
https://cdn.jsdelivr.net/gh/jhilton-fairsquare/fairsquare-libform@v0.1.0/dist/fairsquare-form.iife.min.js
```

`dist/` is tracked in git so the file is immediately available at any commit/tag — no separate publish pipeline. After every source change, regenerate (`npm run build`) and commit `dist/` alongside the source. A CI check that runs `npm run build && git diff --exit-code dist/` will catch drift.

---

## Browser support

ES2020 target. Concretely: any browser released after 2020 (Chromium-based, modern Firefox, modern Safari). Framer and Webflow consumer runtimes are well within that window. Drop the build target to `es2017` if you ever need to support older browsers — esbuild will handle the downlevel.

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
| `tierToRevenue` table + tier grouping | `enums.TIER_TO_REVENUE_RANGE` + `tierMapPlugin` |
| `dataLayer.push({event: "gaEvent", …})` | `dataLayerPlugin` (with reliable delivery + no lookup tables) |
| `fieldMap` with `{ static: … }` | `staticFieldsPlugin` |
| `optionalFields` query-param capture | `queryParamsPlugin` |
| `MutationObserver` + form ready | `mount()` (with optional `watchReplacement`) |
| Document-level click delegation | Form `submit` event (rebinds via `watchReplacement` if Framer hot-swaps) |
| `window.location.href = res.url` on success | `redirectOnUrlPlugin` (now handles 4xx/5xx fallback URLs too) |

Differences worth knowing:

- **Email validator** now accepts multi-label domains (`user@mail.fairsquare.com`). Prod's regex rejected them — that was a real, latent bug.
- **`tierDetail`** in the GA event reads `<option>.text` directly instead of looking up the prod `tierToRevenue` table. Same value, no mapping table on the client.
- **Submission errors fire a `gaEventError`** in the dataLayer so you can measure failure rates — prod fires the success event regardless of outcome.
- **Failed submits don't redirect** by default (validation 400 keeps the user on the form). Prod's flow had no failure path UI; this is an improvement.

---

## Testing

```bash
npm test           # all 196 tests
npm test -- tests/transport.test.js
npm run test:coverage
```

Tests cover:

| File | Tests | What |
|---|---|---|
| `validators.test.js` | 79 | Every validator, valid + invalid + composition |
| `transport.test.js` | 12 | Every Lead Gateway response shape, timeout, idempotency |
| `plugins.test.js` | 32 | redirectOnUrl branches, serverValidation, tierMap, queryParams, attribution, staticFields |
| `dataLayer.test.js` | 22 | Source resolution, fireOn modes, every reliability strategy, dataLayer→redirect ordering |
| `fbclidResync.test.js` | 11 | Enrich shape, immediate/retry/timeout, custom config, controller integration |
| `controller.test.js` | 7 | Mount, submit happy path, error path, setFieldErrors |
| `mount.test.js` | 6 | waitForElement immediate/late/timeout, mount + watchReplacement |
| `formatters.test.js` | 9 | formatPhoneUS, formatZipUS, stripDashes |
| `enums.test.js` | 18 | All enums frozen, tier table verbatim, oneOf |

The build pipeline is intentionally not in the test suite — tests run against source, the build is downstream packaging. Add `npm run build && git diff --exit-code dist/` to CI to enforce parity.

---

## Open questions / known gaps

- **Is form 2 missing `journey` intentional?** Prod's standalone form sends `journey: "NFCoreApply"`; the footer form omits it. Either the gateway defaults it server-side or this is a config drift nobody noticed. Worth confirming.
- **Tier codes (`Tier 1a`/`Tier 2b`/etc.) are not in the documented field reference.** The gateway accepts them today (unknown fields are ignored per the spec) but they're effectively dead weight. Could be removed once we confirm nothing downstream consumes them.
- **No CI yet.** The recommended setup: GitHub Actions running `npm test` + `npm run build` + `git diff --exit-code dist/` on every PR.
- **No README for plugin authors with TypeScript types.** JSDoc `@typedef`s for `FieldConfig | Validator | Plugin | Transport | Context` would give consuming codebases IDE support without a TS migration. Tracked as Phase 3 work.

> **Note:** `"Framer"` is a real registered `formType`/journey, not a placeholder. Treat it as a first-class value alongside `NFCoreApply`, `XPRSApply`, etc.
