// form-core/plugins/dataLayer.js
//
// Pushes a GTM-style event to window.dataLayer when the form is submitted.
// Each parameter is sourced from one of three explicit paths — no client-side
// lookup tables — and the plugin gates a downstream redirect just long enough
// to give GTM a chance to ship the hit.
//
// Source kinds (used inside `params`):
//   { source: "static",   value: "..." }                       // literal
//   { source: "form",     name: "fieldName" }                  // form field value
//   { source: "form",     name: "fieldName", as: "label" }     // <option>.text for <select>
//   { source: "response", path: "deeply.nested.field" }        // Lead Gateway response
// Plus shorthands:
//   "literal string"                                            // → static
//   (values, response, ctx) => "computed"                       // function
//
// Reliability strategies (default `auto`):
//   "auto"          — eventCallback when window.gtag exists, else microtask
//   "eventCallback" — gtag('event', ..., { event_callback, event_timeout })
//   "microtask"     — push then drain two microtasks (≈ 0ms perceptible delay)
//   "delay"         — push then setTimeout(reliabilityTimeoutMs)
//   "none"          — push and return immediately (lossy)
//
// IMPORTANT: register this plugin BEFORE redirectOnUrlPlugin so the redirect
// awaits the dataLayer hook in the controller's plugin loop.

export const sources = {
  static: (value) => ({ source: "static", value }),
  form: (name, opts = {}) => ({ source: "form", name, ...opts }),
  response: (path, opts = {}) => ({ source: "response", path, ...opts }),
};

const getPath = (obj, path) => {
  if (!obj || !path) return undefined;
  return String(path)
    .split(".")
    .reduce((acc, k) => (acc != null ? acc[k] : undefined), obj);
};

const readSelectLabel = (ctx, name) => {
  if (typeof document === "undefined" || !ctx?.formSelector) return null;
  const el = document.querySelector(`${ctx.formSelector} [name="${name}"]`);
  if (!el) return null;
  if (el.tagName !== "SELECT") return el.value || "";
  const opt = el.options[el.selectedIndex];
  if (!opt) return "";
  // <option>.text falls back to label, then to the value
  return opt.text || opt.label || opt.value || "";
};

export const resolveSource = (cfg, ctx, values, response) => {
  if (cfg == null) return "";
  if (typeof cfg === "string" || typeof cfg === "number" || typeof cfg === "boolean") {
    return String(cfg);
  }
  if (typeof cfg === "function") {
    try { return cfg(values || {}, response, ctx) ?? ""; } catch { return ""; }
  }
  if (typeof cfg !== "object") return "";

  const dflt = cfg.default ?? "";

  switch (cfg.source) {
    case "static":
      return cfg.value ?? dflt;

    case "form": {
      if (!cfg.name) return dflt;
      if (cfg.as === "label") {
        const v = readSelectLabel(ctx, cfg.name);
        return v != null && v !== "" ? v : dflt;
      }
      const v = values?.[cfg.name];
      return v != null && v !== "" ? v : dflt;
    }

    case "response": {
      const v = getPath(response, cfg.path || cfg.name);
      return v != null && v !== "" ? v : dflt;
    }

    default:
      return dflt;
  }
};

const resolveStrategy = (reliability) => {
  if (reliability !== "auto") return reliability;
  if (typeof window !== "undefined" && typeof window.gtag === "function") return "eventCallback";
  return "microtask";
};

const pushAndAwait = async ({ payload, reliability, reliabilityTimeoutMs }) => {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];

  const strategy = resolveStrategy(reliability);

  if (strategy === "eventCallback" && typeof window.gtag === "function") {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const timer = setTimeout(finish, reliabilityTimeoutMs);
      try {
        // gtag pushes to dataLayer in the shape GTM/GA4 understands.
        window.gtag("event", payload.event, {
          ...payload,
          event_callback: () => { clearTimeout(timer); finish(); },
          event_timeout: reliabilityTimeoutMs,
        });
      } catch {
        clearTimeout(timer);
        window.dataLayer.push(payload);
        finish();
      }
    });
    return;
  }

  // Push to dataLayer directly. GTM's listener picks it up on the next tick.
  window.dataLayer.push(payload);

  if (strategy === "microtask") {
    // Two microtask drains let GTM evaluate triggers and start any sendBeacon
    // it has queued. Imperceptible to the user (sub-millisecond).
    await Promise.resolve();
    await Promise.resolve();
    return;
  }
  if (strategy === "delay") {
    await new Promise((r) => setTimeout(r, reliabilityTimeoutMs));
    return;
  }
  // "none" → return immediately (lossy).
};

/**
 * dataLayerPlugin
 *
 * @param {object} config
 * @param {string}  [config.event="gaEvent"]
 * @param {string}  [config.eventCategory="forms"]
 * @param {string}  [config.eventAction="submission"]
 * @param {string}  [config.errorEvent="gaEventError"]   event name for error fires
 * @param {string}  [config.form_type]                   per-form identifier (required by spec)
 * @param {Record<string, any>} [config.params={}]       parameter → source spec map
 * @param {"submit"|"success"|"both"} [config.fireOn="success"]
 * @param {boolean} [config.alsoFireOnError=true]
 * @param {"auto"|"eventCallback"|"microtask"|"delay"|"none"} [config.reliability="auto"]
 * @param {number}  [config.reliabilityTimeoutMs=300]    eventCallback ceiling / delay length
 */
export const dataLayerPlugin = (config = {}) => {
  const {
    event = "gaEvent",
    eventCategory = "forms",
    eventAction = "submission",
    errorEvent = "gaEventError",
    form_type,
    params = {},
    fireOn = "success",
    alsoFireOnError = true,
    reliability = "auto",
    reliabilityTimeoutMs = 300,
  } = config;

  const buildPayload = (kind, ctx, values, response) => {
    const out = {
      event: kind === "error" ? errorEvent : event,
      eventCategory,
      eventAction,
    };
    if (form_type) out.form_type = form_type;
    for (const [key, sourceCfg] of Object.entries(params)) {
      out[key] = resolveSource(sourceCfg, ctx, values, response);
    }
    if (kind === "error" && response && typeof response === "object") {
      // For error fires `response` is a TransportError; surface useful breadcrumbs.
      if (response.status != null) out.errorStatus = response.status;
      if (response.message) out.errorMessage = response.message;
    }
    return out;
  };

  const fireOnSubmit = fireOn === "submit" || fireOn === "both";
  const fireOnSuccess = fireOn === "success" || fireOn === "both";

  const plugin = {
    init() { /* nothing — payload is built lazily */ },
  };

  if (fireOnSubmit) {
    plugin.onBeforeSend = async (_payload, ctx) => {
      const values = ctx.getValues();
      const dlPayload = buildPayload("submit", ctx, values, null);
      await pushAndAwait({ payload: dlPayload, reliability, reliabilityTimeoutMs });
    };
  }

  if (fireOnSuccess) {
    plugin.onSuccess = async (response, ctx) => {
      const values = ctx.getValues();
      const dlPayload = buildPayload("success", ctx, values, response);
      await pushAndAwait({ payload: dlPayload, reliability, reliabilityTimeoutMs });
    };
  }

  if (alsoFireOnError) {
    plugin.onError = async (err, ctx) => {
      const values = ctx.getValues();
      // Pass err.body so { source: "response", path } can pull from a structured
      // error envelope as well — useful when the API returns partial dimensions.
      const responseLike = err && typeof err === "object" && err.body && typeof err.body === "object"
        ? err.body
        : null;
      const dlPayload = buildPayload("error", ctx, values, responseLike);
      // Also surface high-level error diagnostics on the event itself.
      if (err?.status != null) dlPayload.errorStatus = err.status;
      if (err?.message) dlPayload.errorMessage = err.message;
      await pushAndAwait({ payload: dlPayload, reliability, reliabilityTimeoutMs });
    };
  }

  return plugin;
};
