/*! @fairsquare/libform v0.1.0 | https://github.com/jhilton-fairsquare/fairsquare-libform */
var FairsquareForm = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all2) => {
    for (var name in all2)
      __defProp(target, name, { get: all2[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/index.js
  var index_exports = {};
  __export(index_exports, {
    TransportError: () => TransportError,
    createForm: () => createForm,
    dataLayerSources: () => sources,
    enums: () => enums_exports,
    formatters: () => formatters_exports,
    plugins: () => plugins,
    presets: () => presets,
    utils: () => utils,
    validators: () => validators_exports
  });

  // lib/form-core/FormController.js
  var FormController = class {
    constructor({ id, fields, onSubmit, onSuccess, onError, transport: transport2, plugins: plugins2 = [], dom: dom2, debug = false }) {
      this.id = id;
      this.fields = fields;
      this.onSubmit = onSubmit;
      this.onSuccess = onSuccess || (() => {
      });
      this.onError = onError || (() => {
      });
      this.transport = transport2;
      this.plugins = plugins2;
      this.dom = dom2;
      this.debug = debug;
      this.state = { submitting: false, errors: {} };
      this.formSelector = `[data-form="${this.id}"]`;
      this._wire();
      this.plugins.forEach((p) => p.init?.(this));
    }
    _log(...args) {
      if (this.debug && typeof console !== "undefined") console.log("[libform]", ...args);
    }
    _fieldSelector(name) {
      return `${this.formSelector} [name="${name}"]`;
    }
    _wire() {
      const formEl = this.dom.query(this.formSelector);
      if (!formEl) {
        this._log(`form not found for selector ${this.formSelector}`);
        return;
      }
      this.formEl = formEl;
      this.dom.on(formEl, "submit", async (e) => {
        e.preventDefault();
        await this.submit();
      });
      Object.keys(this.fields).forEach((name) => {
        const input = this.dom.query(this._fieldSelector(name));
        if (!input) return;
        const field = this.fields[name];
        this.dom.on(input, "blur", async () => {
          const { valid, message } = await field.validate(this._getValue(name), this.getValues());
          if (!valid) this._setFieldError(name, message);
          else this._clearFieldError(name);
        });
        if (typeof field.format === "function") {
          this.dom.on(input, "input", () => {
            const next = field.format(input.value);
            if (next !== input.value) input.value = next;
          });
        }
      });
    }
    _getValue(name) {
      const field = this.fields[name];
      try {
        const v = field.get?.();
        return v;
      } catch (e) {
        return "";
      }
    }
    getValues() {
      const values = {};
      for (const name of Object.keys(this.fields)) {
        values[name] = this._getValue(name);
      }
      return values;
    }
    async validateAll() {
      const values = this.getValues();
      const results = await Promise.all(
        Object.entries(this.fields).map(async ([name, f]) => {
          const { valid, message } = await f.validate(values[name], values);
          return [name, { valid, message }];
        })
      );
      const errors = Object.fromEntries(results.filter(([, r]) => !r.valid).map(([n, r]) => [n, r.message]));
      this.state.errors = errors;
      for (const [name, msg] of Object.entries(errors)) this._setFieldError(name, msg);
      for (const name of Object.keys(this.fields)) if (!errors[name]) this._clearFieldError(name);
      return { valid: Object.keys(errors).length === 0, errors };
    }
    async submit() {
      if (this.state.submitting) return;
      const { valid, errors } = await this.validateAll();
      if (!valid) {
        this.plugins.forEach((p) => p.onValidationFail?.(errors, this));
        return;
      }
      this.state.submitting = true;
      const submitSelector = `${this.formSelector} [type="submit"]`;
      this.dom.setDisabled(submitSelector, true);
      let payload = this.onSubmit ? this.onSubmit(this.getValues()) : this.getValues();
      if (payload && typeof payload.then === "function") payload = await payload;
      for (const p of this.plugins) {
        if (typeof p.enrich !== "function") continue;
        try {
          const next = await p.enrich(payload, this);
          if (next != null) payload = next;
        } catch (e) {
          this._log("enrich error", e);
        }
      }
      for (const p of this.plugins) {
        if (typeof p.onBeforeSend !== "function") continue;
        try {
          await p.onBeforeSend(payload, this);
        } catch (e) {
          this._log("onBeforeSend error", e);
        }
      }
      try {
        const res = await this.transport.send(payload, this);
        for (const p of this.plugins) {
          if (typeof p.onAfterSend !== "function") continue;
          try {
            await p.onAfterSend({ ok: true, res }, this);
          } catch (e) {
            this._log("onAfterSend error", e);
          }
        }
        for (const p of this.plugins) {
          if (typeof p.onSuccess !== "function") continue;
          try {
            await p.onSuccess(res, this);
          } catch (e) {
            this._log("onSuccess plugin error", e);
          }
        }
        await this.onSuccess(res, this);
      } catch (err) {
        for (const p of this.plugins) {
          if (typeof p.onAfterSend !== "function") continue;
          try {
            await p.onAfterSend({ ok: false, err }, this);
          } catch (e) {
            this._log("onAfterSend error", e);
          }
        }
        for (const p of this.plugins) {
          if (typeof p.onError !== "function") continue;
          try {
            await p.onError(err, this);
          } catch (e) {
            this._log("onError plugin error", e);
          }
        }
        await this.onError(err, this);
      } finally {
        this.state.submitting = false;
        this.dom.setDisabled(submitSelector, false);
      }
    }
    // Public — for plugins / consumers reacting to server-side validation
    // (e.g., a 400 with { fields: ["email", "phone"] } from the API).
    setFieldError(name, message) {
      this._setFieldError(name, message);
    }
    clearFieldError(name) {
      this._clearFieldError(name);
    }
    setFieldErrors(map) {
      if (!map) return;
      for (const [name, msg] of Object.entries(map)) this._setFieldError(name, msg);
    }
    clearAllErrors() {
      for (const name of Object.keys(this.state.errors)) this._clearFieldError(name);
    }
    _setFieldError(name, message) {
      this.state.errors[name] = message;
      this.dom.setError(this._fieldSelector(name), message);
    }
    _clearFieldError(name) {
      delete this.state.errors[name];
      this.dom.clearError(this._fieldSelector(name));
    }
  };

  // lib/form-core/adapters/dom.js
  var errorContainerFor = (input) => {
    if (!input) return null;
    if (input.type === "checkbox" || input.type === "radio") {
      return input.closest("label") || input;
    }
    return input.closest(".field, [data-field]") || input;
  };
  var findOrCreateHint = (anchor) => {
    if (!anchor || !anchor.parentNode) return null;
    const sib = anchor.nextElementSibling;
    if (sib && sib.classList?.contains("field-error")) return sib;
    const hint = document.createElement("div");
    hint.className = "field-error";
    anchor.parentNode.insertBefore(hint, anchor.nextSibling);
    return hint;
  };
  var dom = {
    query: (selector, root = document) => (root || document).querySelector(selector),
    queryAll: (selector, root = document) => Array.from((root || document).querySelectorAll(selector)),
    on: (el, evt, fn, opts) => el && el.addEventListener(evt, fn, opts),
    off: (el, evt, fn, opts) => el && el.removeEventListener(evt, fn, opts),
    setError: (selector, message) => {
      const input = document.querySelector(selector);
      if (!input) return;
      input.classList.add("is-invalid");
      input.setAttribute("aria-invalid", "true");
      const anchor = errorContainerFor(input);
      const hint = findOrCreateHint(anchor);
      if (hint) hint.textContent = message || "";
    },
    clearError: (selector) => {
      const input = document.querySelector(selector);
      if (!input) return;
      input.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      const anchor = errorContainerFor(input);
      if (!anchor) return;
      const sib = anchor.nextElementSibling;
      if (sib && sib.classList?.contains("field-error")) sib.remove();
    },
    setDisabled: (selector, disabled) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.disabled = !!disabled;
        if (disabled) el.setAttribute("aria-busy", "true");
        else el.removeAttribute("aria-busy");
      });
    }
  };

  // lib/form-core/adapters/transport.js
  var TransportError = class extends Error {
    constructor({ status, body, url, message }) {
      super(message || `Submit failed (${status})`);
      this.name = "TransportError";
      this.status = status;
      this.body = body;
      this.url = url;
    }
  };
  var parseBody = async (res) => {
    const ct = res.headers?.get?.("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    try {
      return await res.text();
    } catch {
      return null;
    }
  };
  var transport = (endpoint, options = {}) => {
    const {
      headers = {},
      timeoutMs = 15e3,
      credentials = "omit",
      idempotencyKey,
      transformPayload
    } = options;
    return {
      async send(payload, ctx) {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = controller && timeoutMs ? setTimeout(() => controller.abort(new Error("Submit timed out")), timeoutMs) : null;
        const finalPayload = transformPayload ? transformPayload(payload, ctx) : payload;
        const reqHeaders = {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers
        };
        if (idempotencyKey) {
          try {
            const key = idempotencyKey(finalPayload, ctx);
            if (key) reqHeaders["Idempotency-Key"] = key;
          } catch {
          }
        }
        let res;
        try {
          res = await fetch(endpoint, {
            method: "POST",
            credentials,
            headers: reqHeaders,
            body: JSON.stringify(finalPayload),
            signal: controller?.signal
          });
        } catch (err) {
          if (timer) clearTimeout(timer);
          throw new TransportError({
            status: 0,
            body: null,
            url: null,
            message: err?.message || "Network error"
          });
        } finally {
          if (timer) clearTimeout(timer);
        }
        const body = await parseBody(res);
        const url = body && typeof body === "object" && body.url || null;
        if (!res.ok) {
          throw new TransportError({
            status: res.status,
            body,
            url,
            message: body && typeof body === "object" && body.message || typeof body === "string" && body || res.statusText || `Submit failed (${res.status})`
          });
        }
        return body && typeof body === "object" ? body : {};
      }
    };
  };

  // lib/form-core/mount.js
  var docReady = () => typeof document !== "undefined" && (document.readyState === "interactive" || document.readyState === "complete");
  var onceReady = (fn) => {
    if (docReady()) {
      fn();
      return;
    }
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  };
  function waitForElement(selector, { timeout = 1e4, root } = {}) {
    return new Promise((resolve, reject) => {
      const target = root || (typeof document !== "undefined" ? document : null);
      if (!target) return reject(new Error("waitForElement: no document"));
      const found = target.querySelector(selector);
      if (found) return resolve(found);
      let observer;
      const timer = setTimeout(() => {
        observer?.disconnect();
        reject(new Error(`waitForElement: timeout for ${selector}`));
      }, timeout);
      observer = new MutationObserver(() => {
        const el = target.querySelector(selector);
        if (el) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(target === document ? document.body : target, {
        childList: true,
        subtree: true
      });
    });
  }
  async function mount(selector, setup, opts = {}) {
    const { timeout = 1e4, watchReplacement = false } = opts;
    await new Promise((res) => onceReady(res));
    let cleanup;
    let lastEl = null;
    let stopped = false;
    let replaceObserver;
    const run = (el) => {
      if (stopped || el === lastEl) return;
      if (typeof cleanup === "function") cleanup();
      lastEl = el;
      cleanup = setup(el) || void 0;
    };
    const initial = await waitForElement(selector, { timeout });
    run(initial);
    if (watchReplacement) {
      replaceObserver = new MutationObserver(() => {
        if (stopped || typeof document === "undefined" || !document) return;
        const el = document.querySelector(selector);
        if (el && el !== lastEl) run(el);
      });
      replaceObserver.observe(document.body, { childList: true, subtree: true });
    }
    return {
      stop: () => {
        stopped = true;
        replaceObserver?.disconnect();
        if (typeof cleanup === "function") cleanup();
      }
    };
  }

  // lib/FormFactory.js
  function createForm(config) {
    const {
      id,
      fields,
      endpoint,
      plugins: plugins2 = [],
      onSubmit,
      onSuccess,
      onError,
      transport: transport2 = transport(endpoint),
      domAdapter = dom,
      mountTimeout = 1e4,
      watchReplacement = false,
      debug = false
    } = config;
    if (!id) throw new Error("createForm: `id` is required");
    if (!fields) throw new Error("createForm: `fields` is required");
    let controller = null;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    const handle = {
      ready,
      controller: () => controller,
      stop: () => mounted?.then((m) => m.stop()).catch(() => {
      })
    };
    const mounted = mount(
      `[data-form="${id}"], [id="${id}"]`,
      (formEl) => {
        if (formEl.getAttribute("data-form") !== id) {
          formEl.setAttribute("data-form", id);
        }
        controller = new FormController({
          id,
          fields,
          plugins: plugins2,
          onSubmit,
          onSuccess,
          onError,
          transport: transport2,
          dom: domAdapter,
          debug
        });
        resolveReady(controller);
        return () => {
          controller = null;
        };
      },
      { timeout: mountTimeout, watchReplacement }
    ).catch((err) => {
      rejectReady(err);
      if (onError) onError(err, null);
    });
    return handle;
  }

  // lib/form-core/validators/index.js
  var validators_exports = {};
  __export(validators_exports, {
    __testing: () => __testing,
    all: () => all,
    any: () => any,
    email: () => email,
    emailStrict: () => emailStrict,
    fullName: () => fullName,
    fullNameLettersOnly: () => fullNameLettersOnly,
    lettersHyphenSpaces: () => lettersHyphenSpaces,
    maxLength: () => maxLength,
    minLength: () => minLength,
    mustAccept: () => mustAccept,
    pattern: () => pattern,
    phoneBasic: () => phoneBasic,
    phoneDashedUS: () => phoneDashedUS,
    phoneUS: () => phoneUS,
    required: () => required,
    requiredSelect: () => requiredSelect,
    zipUS: () => zipUS
  });
  var ok = () => ({ valid: true, message: "" });
  var fail = (message) => ({ valid: false, message });
  var toStr = (v) => {
    if (v == null) return "";
    const t = typeof v;
    if (t === "string") return v;
    if (t === "number" || t === "boolean") return String(v);
    if (t === "object") {
      if ("value" in v && (typeof v.value === "string" || typeof v.value === "number" || typeof v.value === "boolean")) {
        return String(v.value);
      }
      const keys = Object.keys(v);
      if (keys.length === 1) {
        const val = v[keys[0]];
        if (["string", "number", "boolean"].includes(typeof val)) return String(val);
      }
      if (Array.isArray(v)) return v.map(toStr).filter(Boolean).join(",");
      const s = v.toString?.();
      if (typeof s === "string" && s !== "[object Object]") return s;
      return "";
    }
    return "";
  };
  var all = (...validators) => async (value, values) => {
    for (const v of validators) {
      const res = await v(value, values);
      if (!res.valid) return res;
    }
    return ok();
  };
  var any = (...validators) => async (value, values) => {
    let lastMsg = "";
    for (const v of validators) {
      const res = await v(value, values);
      if (res.valid) return ok();
      lastMsg = res.message || lastMsg;
    }
    return fail(lastMsg || "Invalid value");
  };
  var required = (msg = "This field is required. Snap to it.") => async (value) => {
    const s = toStr(value).trim();
    return s ? ok() : fail(msg);
  };
  var email = (msg = "Please enter a valid email address.") => async (value) => {
    const s = toStr(value).trim();
    if (!s) return fail(msg);
    const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    return okEmail ? ok() : fail(msg);
  };
  var fullName = (msg = "Please enter your first and last name.") => async (value) => {
    const s = toStr(value).trim();
    const parts = s.split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? ok() : fail(msg);
  };
  var minLength = (n, msg = `Must be at least ${n} characters`) => async (value) => {
    const s = toStr(value);
    return s.length >= n ? ok() : fail(msg);
  };
  var maxLength = (n, msg = `Must be at most ${n} characters`) => async (value) => {
    const s = toStr(value);
    return s.length <= n ? ok() : fail(msg);
  };
  var pattern = (re, msg = "Invalid format") => async (value) => {
    const s = toStr(value);
    return re.test(s) ? ok() : fail(msg);
  };
  var phoneBasic = (msg = "Please enter a valid phone number.") => async (value) => {
    const s = toStr(value).trim();
    return /^\+?[0-9\s\-()]{7,20}$/.test(s) ? ok() : fail(msg);
  };
  var phoneDashedUS = (msg = "Please enter a valid phone number (e.g., 123-456-7890).") => async (value) => {
    const s = toStr(value).trim();
    return /^\d{3}-\d{3}-\d{4}$/.test(s) ? ok() : fail(msg);
  };
  var phoneUS = (msg = "Please enter a valid phone number (###-###-####).") => async (value) => {
    const s = toStr(value).trim();
    return /^\s*[2-9]\d{2}[ -]?\d{3}[ -]?\d{4}\s*$/.test(s) ? ok() : fail(msg);
  };
  var zipUS = (msg) => async (value) => {
    const s = toStr(value).trim();
    const base = s.slice(0, 5);
    if (!/^\d{5}$/.test(base)) {
      return fail(msg || "Please enter a valid 5-digit ZIP code (e.g., 12345).");
    }
    if (base === "00000") {
      return fail(msg || "ZIP code cannot be all zeros.");
    }
    const n = parseInt(base, 10);
    if (n < 501 || n > 99950) {
      return fail(msg || "Please enter a valid U.S. ZIP code.");
    }
    return ok();
  };
  var emailStrict = (msg = "Please enter a valid email address.") => async (value) => {
    const s = toStr(value).trim();
    if (!s) return fail(msg);
    const re = /^[^\s@]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
    if (!re.test(s)) return fail(msg);
    if (/\.\./.test(s)) return fail(msg);
    const domain = (s.split("@")[1] || "").replace(/\.$/, "").toLowerCase();
    const labels = domain.split(".");
    if (labels.length >= 2 && labels[labels.length - 1] === labels[labels.length - 2]) {
      return fail(msg);
    }
    return ok();
  };
  var lettersHyphenSpaces = (msg = "Please use letters only.") => async (value) => {
    const s = toStr(value).trim();
    return /^[A-Za-z]+(?:-[A-Za-z]+)*(?: [A-Za-z]+(?:-[A-Za-z]+)*)*$/.test(s) ? ok() : fail(msg);
  };
  var fullNameLettersOnly = (msg = "Please enter your first and last name using letters only.") => async (value) => {
    const s = toStr(value).trim();
    return /^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(s) ? ok() : fail(msg);
  };
  var requiredSelect = (msg = "Please select an option.") => async (value) => {
    const s = toStr(value).trim();
    return s ? ok() : fail(msg);
  };
  var mustAccept = (msg = "You must accept the privacy policy.") => async (value) => {
    if (value === true) return ok();
    const s = toStr(value).toLowerCase();
    return s === "true" || s === "on" || s === "1" || s === "yes" ? ok() : fail(msg);
  };
  var __testing = { toStr };

  // lib/form-core/formatters/index.js
  var formatters_exports = {};
  __export(formatters_exports, {
    formatPhoneUS: () => formatPhoneUS,
    formatZipUS: () => formatZipUS,
    stripDashes: () => stripDashes
  });
  var toStr2 = (v) => v == null ? "" : String(v);
  var formatPhoneUS = (raw) => {
    const digits = toStr2(raw).replace(/\D/g, "").slice(0, 10);
    if (digits.length >= 7) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
    if (digits.length >= 4) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
    }
    return digits;
  };
  var formatZipUS = (raw) => toStr2(raw).replace(/\D/g, "").slice(0, 5);
  var stripDashes = (raw) => toStr2(raw).replace(/-/g, "");

  // lib/form-core/enums.js
  var enums_exports = {};
  __export(enums_exports, {
    ANNUAL_REVENUE_RANGES: () => ANNUAL_REVENUE_RANGES,
    CREDIT_RATINGS: () => CREDIT_RATINGS,
    ENTITY_TYPES: () => ENTITY_TYPES,
    INDUSTRIES: () => INDUSTRIES,
    RESPONSE_CHANNELS: () => RESPONSE_CHANNELS,
    TIER_TO_REVENUE_RANGE: () => TIER_TO_REVENUE_RANGE,
    groupTier: () => groupTier,
    oneOf: () => oneOf
  });
  var ANNUAL_REVENUE_RANGES = Object.freeze([
    "Under $120K",
    "$120K-$249K",
    "$250K-$499K",
    "$500K-$999K",
    "Over $1M"
  ]);
  var ENTITY_TYPES = Object.freeze([
    "Sole Proprietorship",
    "Partnership",
    "S Corp",
    "C Corp",
    "LLC"
  ]);
  var CREDIT_RATINGS = Object.freeze(["Excellent", "Good", "Fair", "Poor"]);
  var RESPONSE_CHANNELS = Object.freeze(["Internet", "Internet-PURL"]);
  var INDUSTRIES = Object.freeze([
    "Administrative Support",
    "Agriculture",
    "Arts Entertainment and Recreation",
    "Auto Repair",
    "Commercial Trucking",
    "Construction",
    "Educational Services",
    "Finance and Insurance",
    "Healthcare and Social Assistance",
    "Landscaping",
    "Manufacturing",
    "Medical Practice",
    "Mining",
    "Professional Scientific and Technical Services",
    "Public Administration",
    "Real Estate and Leasing",
    "Restaurants and Food Services",
    "Retail",
    "Utilities",
    "Wholesale Trade",
    "Other"
  ]);
  var TIER_TO_REVENUE_RANGE = Object.freeze({
    "Tier 1a": "Under $120K",
    "Tier 1b": "$120K-$249K",
    "Tier 2a": "$250K-$499K",
    "Tier 2b": "$500K-$999K",
    "Tier 3": "Over $1M"
  });
  var groupTier = (tier) => {
    if (typeof tier !== "string") return "";
    return tier.replace(/\bTier 1[ab]\b/, "Tier 1").replace(/\bTier 2[ab]\b/, "Tier 2");
  };
  var oneOf = (allowed, msg) => async (value) => {
    const s = value == null ? "" : String(value);
    return allowed.includes(s) ? { valid: true, message: "" } : { valid: false, message: msg || `Must be one of: ${allowed.join(", ")}` };
  };

  // lib/utils/cookies.js
  var cookies = {
    get(name) {
      const nameEQ = encodeURIComponent(name) + "=";
      const parts = document.cookie ? document.cookie.split(";") : [];
      for (let c of parts) {
        c = c.trim();
        if (c.indexOf(nameEQ) === 0) {
          try {
            return decodeURIComponent(c.substring(nameEQ.length));
          } catch {
            return c.substring(nameEQ.length);
          }
        }
      }
      return null;
    },
    set(name, value, opts = {}) {
      const {
        // Expiration can be { days: 365 } or a Date via `expires`
        days,
        expires,
        path = "/",
        domain,
        secure = false,
        sameSite = "Lax"
        // "Lax" | "Strict" | "None"
      } = opts;
      let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
      let exp = expires;
      if (!exp && Number.isFinite(days)) {
        const d = /* @__PURE__ */ new Date();
        d.setTime(d.getTime() + days * 24 * 60 * 60 * 1e3);
        exp = d;
      }
      if (exp instanceof Date) cookie += `; Expires=${exp.toUTCString()}`;
      if (path) cookie += `; Path=${path}`;
      if (domain) cookie += `; Domain=${domain}`;
      if (secure) cookie += `; Secure`;
      if (sameSite) cookie += `; SameSite=${sameSite}`;
      document.cookie = cookie;
      return true;
    },
    remove(name, opts = {}) {
      const { path = "/", domain } = opts;
      const d = /* @__PURE__ */ new Date(0);
      let cookie = `${encodeURIComponent(name)}=; Expires=${d.toUTCString()}`;
      if (path) cookie += `; Path=${path}`;
      if (domain) cookie += `; Domain=${domain}`;
      document.cookie = cookie;
      return true;
    },
    has(name) {
      return this.get(name) != null;
    },
    getJSON(name) {
      const v = this.get(name);
      if (!v) return null;
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    },
    setJSON(name, obj, opts) {
      return this.set(name, JSON.stringify(obj), opts);
    }
  };

  // lib/utils/id.js
  var hasCrypto = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  function randByte() {
    if (hasCrypto) {
      const buf = new Uint8Array(1);
      crypto.getRandomValues(buf);
      return buf[0];
    }
    return Math.floor(Math.random() * 256);
  }
  function randNibble() {
    return randByte() & 15;
  }
  function variantNibble() {
    const r = randNibble();
    return r & 3 | 8;
  }
  function generateNFID(pattern2 = "NFID-yxxxxxxxxxxxx") {
    return pattern2.replace(/[xy]/g, (c) => {
      const v = c === "x" ? randNibble() : variantNibble();
      return v.toString(16);
    });
  }
  function getOrCreateClientId({
    cookieName = "nfid",
    pattern: pattern2 = "NFID-yxxxxxxxxxxxx",
    persistDays = 365,
    sameSite = "Lax",
    secure = false,
    path = "/",
    domain,
    // Optional consent hook: return false to avoid setting cookie
    canSetCookie = () => true
  } = {}) {
    const existing = cookies.get(cookieName);
    if (existing) return existing;
    const id = generateNFID(pattern2);
    if (canSetCookie()) {
      cookies.set(cookieName, id, { days: persistDays, sameSite, secure, path, domain });
    }
    return id;
  }

  // lib/form-core/plugins/attribution.js
  var safeWindow = () => typeof window !== "undefined" ? window : null;
  var readPath = () => {
    const w = safeWindow();
    if (!w?.location) return "";
    return w.location.href.split("?")[0].split("#")[0];
  };
  var readLandingPage = () => {
    const w = safeWindow();
    return w?.location?.href || "";
  };
  var readReferrer = () => {
    if (typeof document === "undefined") return "";
    return document.referrer || "";
  };
  var readUserAgent = () => {
    if (typeof navigator === "undefined") return "";
    return navigator.userAgent || "";
  };
  var attributionPlugin = (options = {}) => {
    const {
      clientId: clientIdOpts = {},
      gaCookieName = "_ga",
      fields = {},
      includeNfid = true,
      includeTrackingId = true,
      includeReferrer = true,
      includeLandingPage = true,
      includePath = true,
      includeClientBrowser = true
    } = options;
    const key = (k) => fields[k] || k;
    return {
      init(ctx) {
        const nfid = getOrCreateClientId(clientIdOpts);
        ctx.clientId = nfid;
        const enrich = () => {
          const out = {};
          if (includeNfid) out[key("nfid")] = nfid;
          if (includeTrackingId) {
            const ga = cookies.get(gaCookieName);
            if (ga) out[key("trackingId")] = ga;
          }
          if (includeLandingPage) out[key("landingPage")] = readLandingPage();
          if (includePath) out[key("path")] = readPath();
          if (includeReferrer) out[key("referrer")] = readReferrer();
          if (includeClientBrowser) out[key("clientBrowser")] = readUserAgent();
          return out;
        };
        const prev = ctx.onSubmit;
        ctx.onSubmit = (values) => {
          const base = prev ? prev(values) : values;
          const payload = base || values || {};
          return { ...payload, ...enrich() };
        };
      }
    };
  };

  // lib/utils/querystring.js
  var params = () => new URLSearchParams(
    typeof window !== "undefined" && window.location ? window.location.search : ""
  );
  var querystring = {
    get(name) {
      return params().get(name);
    },
    has(name) {
      return params().has(name);
    },
    pick(keys = []) {
      const qs = params();
      const out = {};
      for (const k of keys) {
        const v = qs.get(k);
        if (v != null && v !== "") out[k] = v;
      }
      return out;
    },
    all() {
      return Object.fromEntries(params().entries());
    }
  };

  // lib/form-core/plugins/queryParams.js
  var DEFAULT_MAP = Object.freeze({
    utm_source: "utmSource",
    utm_medium: "utmMedium",
    utm_campaign: "utmCampaign",
    utm_content: "utmContent",
    utm_term: "utmTerm",
    utm_id: "utmId",
    gclid: "gclid",
    gclsrc: "gclsrc",
    fbclid: "fbclid",
    msclkid: "msclkid"
  });
  var queryParamsPlugin = (options = {}) => {
    const { map, extraMap = {}, useDefaults = true, namespace } = options;
    const finalMap = map ? { ...map } : useDefaults ? { ...DEFAULT_MAP, ...extraMap } : { ...extraMap };
    return {
      init(ctx) {
        const captured = {};
        for (const [urlKey, payloadKey] of Object.entries(finalMap)) {
          const v = querystring.get(urlKey);
          if (v != null && v !== "") captured[payloadKey] = v;
        }
        const prev = ctx.onSubmit;
        ctx.onSubmit = (values) => {
          const base = prev ? prev(values) : values;
          const payload = base || values || {};
          if (Object.keys(captured).length === 0) return payload;
          if (namespace) return { ...payload, [namespace]: { ...payload[namespace] || {}, ...captured } };
          return { ...payload, ...captured };
        };
      }
    };
  };

  // lib/form-core/plugins/tierMap.js
  var tierMapPlugin = (options = {}) => {
    const {
      sourceField = "salesDistributionTier",
      tierField = "salesDistributionTier",
      revenueRangeField = "annualRevenueRange",
      group = true
    } = options;
    return {
      init(ctx) {
        const prev = ctx.onSubmit;
        ctx.onSubmit = (values) => {
          const base = prev ? prev(values) : values;
          const payload = base || values || {};
          const tier = values && values[sourceField] || payload[sourceField] || "";
          const out = { ...payload };
          if (tier) {
            if (tierField) out[tierField] = group ? groupTier(tier) : tier;
            if (revenueRangeField) {
              const range = TIER_TO_REVENUE_RANGE[tier];
              if (range) out[revenueRangeField] = range;
            }
          }
          return out;
        };
      }
    };
  };

  // lib/form-core/plugins/dataLayer.js
  var sources = {
    static: (value) => ({ source: "static", value }),
    form: (name, opts = {}) => ({ source: "form", name, ...opts }),
    response: (path, opts = {}) => ({ source: "response", path, ...opts })
  };
  var getPath = (obj, path) => {
    if (!obj || !path) return void 0;
    return String(path).split(".").reduce((acc, k) => acc != null ? acc[k] : void 0, obj);
  };
  var readSelectLabel = (ctx, name) => {
    if (typeof document === "undefined" || !ctx?.formSelector) return null;
    const el = document.querySelector(`${ctx.formSelector} [name="${name}"]`);
    if (!el) return null;
    if (el.tagName !== "SELECT") return el.value || "";
    const opt = el.options[el.selectedIndex];
    if (!opt) return "";
    return opt.text || opt.label || opt.value || "";
  };
  var resolveSource = (cfg, ctx, values, response) => {
    if (cfg == null) return "";
    if (typeof cfg === "string" || typeof cfg === "number" || typeof cfg === "boolean") {
      return String(cfg);
    }
    if (typeof cfg === "function") {
      try {
        return cfg(values || {}, response, ctx) ?? "";
      } catch {
        return "";
      }
    }
    if (typeof cfg !== "object") return "";
    const dflt = cfg.default ?? "";
    switch (cfg.source) {
      case "static":
        return cfg.value ?? dflt;
      case "form": {
        if (!cfg.name) return dflt;
        if (cfg.as === "label") {
          const v2 = readSelectLabel(ctx, cfg.name);
          return v2 != null && v2 !== "" ? v2 : dflt;
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
  var resolveStrategy = (reliability) => {
    if (reliability !== "auto") return reliability;
    if (typeof window !== "undefined" && typeof window.gtag === "function") return "eventCallback";
    return "microtask";
  };
  var pushAndAwait = async ({ payload, reliability, reliabilityTimeoutMs }) => {
    if (typeof window === "undefined") return;
    window.dataLayer = window.dataLayer || [];
    const strategy = resolveStrategy(reliability);
    if (strategy === "eventCallback" && typeof window.gtag === "function") {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        const timer = setTimeout(finish, reliabilityTimeoutMs);
        try {
          window.gtag("event", payload.event, {
            ...payload,
            event_callback: () => {
              clearTimeout(timer);
              finish();
            },
            event_timeout: reliabilityTimeoutMs
          });
        } catch {
          clearTimeout(timer);
          window.dataLayer.push(payload);
          finish();
        }
      });
      return;
    }
    window.dataLayer.push(payload);
    if (strategy === "microtask") {
      await Promise.resolve();
      await Promise.resolve();
      return;
    }
    if (strategy === "delay") {
      await new Promise((r) => setTimeout(r, reliabilityTimeoutMs));
      return;
    }
  };
  var dataLayerPlugin = (config = {}) => {
    const {
      event = "gaEvent",
      eventCategory = "forms",
      eventAction = "submission",
      errorEvent = "gaEventError",
      form_type,
      params: params2 = {},
      fireOn = "success",
      alsoFireOnError = true,
      reliability = "auto",
      reliabilityTimeoutMs = 300
    } = config;
    const buildPayload = (kind, ctx, values, response) => {
      const out = {
        event: kind === "error" ? errorEvent : event,
        eventCategory,
        eventAction
      };
      if (form_type) out.form_type = form_type;
      for (const [key, sourceCfg] of Object.entries(params2)) {
        out[key] = resolveSource(sourceCfg, ctx, values, response);
      }
      if (kind === "error" && response && typeof response === "object") {
        if (response.status != null) out.errorStatus = response.status;
        if (response.message) out.errorMessage = response.message;
      }
      return out;
    };
    const fireOnSubmit = fireOn === "submit" || fireOn === "both";
    const fireOnSuccess = fireOn === "success" || fireOn === "both";
    const plugin = {
      init() {
      }
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
        const responseLike = err && typeof err === "object" && err.body && typeof err.body === "object" ? err.body : null;
        const dlPayload = buildPayload("error", ctx, values, responseLike);
        if (err?.status != null) dlPayload.errorStatus = err.status;
        if (err?.message) dlPayload.errorMessage = err.message;
        await pushAndAwait({ payload: dlPayload, reliability, reliabilityTimeoutMs });
      };
    }
    return plugin;
  };

  // lib/form-core/plugins/fbclidResync.js
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var fbclidResyncPlugin = (options = {}) => {
    const {
      cookieName = "_fbp",
      urlParam = "fbclid",
      field = "landingPage",
      maxWaitMs = 3e3,
      pollIntervalMs = 150,
      getHref
    } = options;
    const readHref = () => {
      if (typeof getHref === "function") return getHref();
      if (typeof window !== "undefined" && window.location) return window.location.href;
      return "";
    };
    return {
      enrich: async (payload) => {
        const href = readHref();
        if (!href) return payload;
        let url;
        try {
          url = new URL(href);
        } catch {
          return payload;
        }
        if (!url.searchParams.has(urlParam)) return payload;
        const deadline = Date.now() + Math.max(0, maxWaitMs);
        const tryRead = () => cookies.get(cookieName);
        let val = tryRead();
        while (!val && Date.now() < deadline) {
          await sleep(pollIntervalMs);
          val = tryRead();
        }
        if (!val) return payload;
        url.searchParams.set(urlParam, val);
        return { ...payload, [field]: url.toString() };
      }
    };
  };

  // lib/form-core/plugins/staticFields.js
  var staticFieldsPlugin = (statics = {}, options = {}) => {
    const { mode = "override" } = options;
    const clean = {};
    for (const [k, v] of Object.entries(statics)) {
      if (v !== void 0 && v !== null) clean[k] = v;
    }
    return {
      enrich: async (payload) => {
        if (mode === "fill") {
          const out = { ...payload };
          for (const [k, v] of Object.entries(clean)) {
            if (out[k] === void 0 || out[k] === null || out[k] === "") out[k] = v;
          }
          return out;
        }
        return { ...payload, ...clean };
      }
    };
  };

  // lib/form-core/plugins/submitButton.js
  var SPINNER_CLASS = "libform-spinner";
  var STYLE_ID = "libform-submit-button-styles";
  var injectStylesOnce = () => {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    .${SPINNER_CLASS} {
      box-sizing: border-box;
      display: inline-block;
      vertical-align: middle;
      width: 16px;
      height: 16px;
      margin-left: 8px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: libform-spin 0.6s linear infinite;
    }
    @keyframes libform-spin { to { transform: rotate(360deg); } }
  `;
    document.head.appendChild(style);
  };
  var findButton = (ctx) => {
    if (typeof document === "undefined") return null;
    return document.querySelector(`${ctx.formSelector} [type="submit"]`);
  };
  var start = (ctx, iconSelector) => {
    const btn = findButton(ctx);
    if (!btn) return;
    btn.setAttribute("aria-busy", "true");
    if (iconSelector) {
      btn.querySelectorAll(iconSelector).forEach((el) => {
        el.dataset.libformPrevDisplay = el.style.display || "";
        el.style.display = "none";
      });
    }
    if (!btn.querySelector(`.${SPINNER_CLASS}`)) {
      const spinner = document.createElement("span");
      spinner.className = SPINNER_CLASS;
      spinner.setAttribute("aria-hidden", "true");
      btn.appendChild(spinner);
    }
  };
  var stop = (ctx, iconSelector) => {
    const btn = findButton(ctx);
    if (!btn) return;
    btn.removeAttribute("aria-busy");
    btn.querySelectorAll(`.${SPINNER_CLASS}`).forEach((el) => el.remove());
    if (iconSelector) {
      btn.querySelectorAll(iconSelector).forEach((el) => {
        const prev = el.dataset.libformPrevDisplay;
        el.style.display = prev ?? "";
        delete el.dataset.libformPrevDisplay;
      });
    }
  };
  var submitButtonPlugin = (options = {}) => {
    const { iconSelector = "svg", injectStyles = true } = options;
    return {
      init() {
        if (injectStyles) injectStylesOnce();
      },
      onBeforeSend(_payload, ctx) {
        start(ctx, iconSelector);
      },
      onAfterSend(_outcome, ctx) {
        stop(ctx, iconSelector);
      }
    };
  };

  // lib/form-core/plugins/redirectOnUrl.js
  var isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
  var navigate = (url) => {
    if (typeof window === "undefined" || !window.location) return;
    window.location.href = url;
  };
  var redirectOnUrlPlugin = (options = {}) => {
    const {
      onSuccess: redirectOnSuccess = true,
      onMissingFields = true,
      onServerError = true,
      onValidationError = false,
      transformUrl,
      navigate: nav = navigate
    } = options;
    const go = (url, ctx) => {
      if (!isHttpUrl(url)) return false;
      const final = transformUrl ? transformUrl(url, ctx) : url;
      if (!isHttpUrl(final)) return false;
      nav(final);
      return true;
    };
    return {
      onSuccess(res, ctx) {
        if (!redirectOnSuccess) return;
        if (res && typeof res === "object" && isHttpUrl(res.url)) {
          go(res.url, ctx);
        }
      },
      onError(err, ctx) {
        const status = err?.status;
        const body = err?.body;
        const url = err?.url;
        if (!isHttpUrl(url)) return;
        if (status >= 500 && onServerError) {
          go(url, ctx);
          return;
        }
        if (status === 400) {
          const isMissing = body && typeof body === "object" && Array.isArray(body.missingFields);
          const isValidation = body && typeof body === "object" && Array.isArray(body.fields);
          if (isMissing && onMissingFields) {
            go(url, ctx);
            return;
          }
          if (isValidation && onValidationError) {
            go(url, ctx);
            return;
          }
        }
      }
    };
  };

  // lib/form-core/plugins/serverValidation.js
  var DEFAULT_MESSAGES = {
    email: "That email looks invalid. Please check and try again.",
    phone: "That phone number looks invalid. Please check and try again.",
    zipCode: "That ZIP code looks invalid. Please check and try again.",
    state: "Please use a 2-letter state code."
  };
  var serverValidationPlugin = (options = {}) => {
    const {
      messages = {},
      fieldNameMap = {},
      fallbackMessage = "Please check this field and try again."
    } = options;
    const merged = { ...DEFAULT_MESSAGES, ...messages };
    return {
      onError(err, ctx) {
        const body = err?.body;
        if (!body || typeof body !== "object") return;
        if (!Array.isArray(body.fields) || body.fields.length === 0) return;
        if (!ctx || typeof ctx.setFieldErrors !== "function") return;
        const errors = {};
        for (const apiName of body.fields) {
          const formName = fieldNameMap[apiName] || apiName;
          errors[formName] = merged[apiName] || merged[formName] || fallbackMessage;
        }
        ctx.setFieldErrors(errors);
      }
    };
  };

  // lib/presets/framer.js
  var DEFAULT_FIELDS = {
    fullName: { class: "FullName", validate: () => fullNameLettersOnly() },
    firstName: { class: "FirstName", validate: () => lettersHyphenSpaces("Please enter your first name.") },
    lastName: { class: "LastName", validate: () => lettersHyphenSpaces("Please enter your last name.") },
    businessName: { class: "BusinessName", validate: () => lettersHyphenSpaces("Please enter your business name.") },
    email: { class: "Email", validate: () => emailStrict() },
    phone: { class: "Phone", validate: () => phoneUS(), format: formatPhoneUS },
    zipCode: { class: "ZipCode", validate: () => zipUS(), format: formatZipUS },
    salesDistributionTier: { class: "SalesDistributionTier", validate: () => requiredSelect(), kind: "select", coreRule: "select" },
    consent: { class: "PrivacyPolicyAccepted", validate: () => mustAccept(), kind: "checkbox", coreRule: "accept" }
  };
  var OMIT_WHEN_EMPTY = /* @__PURE__ */ new Set(["businessName", "zipCode", "firstName", "lastName"]);
  var findRoot = (id) => {
    if (typeof document === "undefined") return null;
    return document.querySelector(`[data-form="${id}"]`) || document.getElementById(id) || null;
  };
  var resolveField = (root, name, klass) => {
    if (!root) return null;
    return root.querySelector(`[name="${name}"]`) || root.querySelector(`.${klass}`) || null;
  };
  var fieldPresent = (root, name, klass) => resolveField(root, name, klass) != null;
  var readField = (root, name, klass) => {
    const wrap = resolveField(root, name, klass);
    if (!wrap) return "";
    if (wrap.matches("input, select, textarea")) {
      if (wrap.type === "checkbox") return wrap.checked ? "on" : "";
      return (wrap.value || "").toString();
    }
    const inner = wrap.querySelector("input, select, textarea");
    if (!inner) return "";
    if (inner.type === "checkbox") return inner.checked ? "on" : "";
    return (inner.value || "").toString();
  };
  var deriveCookieDomain = () => {
    if (typeof location === "undefined" || !location.hostname) return void 0;
    const parts = location.hostname.split(".");
    if (parts.length < 2) return void 0;
    return "." + parts.slice(-2).join(".");
  };
  var defaultEndpoint = () => {
    if (typeof location === "undefined") return "";
    return location.hostname.indexOf("nationalfunding") !== -1 ? "https://www.nationalfunding.com/api/forms/submit" : "https://stage.nationalfunding.com/api/forms/submit";
  };
  var optionalize = (validator) => async (value, values) => {
    const s = value == null ? "" : String(value).trim();
    if (s === "") return { valid: true, message: "" };
    return validator(value, values);
  };
  function framerForm(config) {
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
      navigate: navigate2,
      quiet = false
    } = config;
    if (!id) throw new Error("framerForm: `id` is required");
    if (!formType) throw new Error("framerForm: `formType` is required");
    if (!gaFormType) throw new Error("framerForm: `gaFormType` is required");
    const optionalSet = new Set(optional);
    const fields = {};
    for (const [name, def] of Object.entries(DEFAULT_FIELDS)) {
      const klass = fieldClasses[name] || def.class;
      const get = () => readField(findRoot(id), name, klass);
      let validate;
      if (validatorOverrides[name]) {
        validate = validatorOverrides[name];
      } else {
        const core = def.validate();
        const wantRequired = !optionalSet.has(name) && def.coreRule !== "accept" && def.coreRule !== "select";
        validate = wantRequired ? all(required(), core) : optionalize(core);
      }
      const wrappedValidate = async (value, values) => {
        if (!fieldPresent(findRoot(id), name, klass)) return { valid: true, message: "" };
        return validate(value, values);
      };
      fields[name] = { get, validate: wrappedValidate };
      if (def.format) fields[name].format = def.format;
    }
    const defaultOnSubmit = (values) => {
      const out = {
        consent: values.consent === "on" || values.consent === true
      };
      if (values.fullName) out.fullName = values.fullName;
      if (values.firstName) out.firstName = values.firstName;
      if (values.lastName) out.lastName = values.lastName;
      if (values.email) out.email = values.email;
      if (values.phone) out.phone = stripDashes(values.phone);
      for (const k of Object.keys(values)) {
        if (k in out) continue;
        if (OMIT_WHEN_EMPTY.has(k) && !values[k]) continue;
        if (values[k] !== "" && values[k] != null) out[k] = values[k];
      }
      return out;
    };
    const defaultDataLayerParams = {
      event_tier: { source: "form", name: "salesDistributionTier" },
      tierDetail: { source: "form", name: "salesDistributionTier", as: "label" },
      zip_code: { source: "form", name: "zipCode", default: "" },
      event_card: { source: "response", path: "event_card", default: "no card submitted" },
      state: { source: "response", path: "state", default: "" }
    };
    const handle = createForm({
      id,
      endpoint,
      watchReplacement: true,
      // Framer can re-render forms; rebind if so
      fields,
      plugins: [
        attributionPlugin({
          clientId: {
            cookieName,
            persistDays: 365,
            sameSite: "Lax",
            secure: typeof location !== "undefined" && location.protocol === "https:",
            domain: cookieDomain
          }
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
          params: { ...defaultDataLayerParams, ...dataLayerParams || {} }
        }),
        redirectOnUrlPlugin(navigate2 ? { navigate: navigate2 } : void 0)
      ],
      onSubmit: onSubmitOverride || defaultOnSubmit,
      onSuccess,
      onError
    });
    if (!quiet && typeof console !== "undefined" && typeof console.warn === "function") {
      handle.ready.then(() => {
        const root = findRoot(id);
        if (!root) return;
        const cls = (n) => fieldClasses[n] || DEFAULT_FIELDS[n].class;
        const has = (n) => fieldPresent(root, n, cls(n));
        const hint = (n) => `name="${n}" (or legacy class ".${cls(n)}")`;
        const missing = [];
        if (!has("fullName") && !(has("firstName") && has("lastName"))) {
          missing.push(
            `name \u2014 set ${hint("fullName")} on one input, OR ${hint("firstName")} + ${hint("lastName")} on two separate inputs`
          );
        }
        for (const f of ["email", "phone", "salesDistributionTier", "consent"]) {
          if (!has(f)) missing.push(`${f} \u2014 set ${hint(f)} on the corresponding input`);
        }
        if (missing.length === 0) return;
        console.warn(
          `[libform/framer] form "${id}" is missing required field${missing.length === 1 ? "" : "s"}.
Validation will silently pass for unwired fields and the submission may go out empty.

` + missing.map((m) => `  \u2022 ${m}`).join("\n") + `

Fix: in Framer's right panel, set each input's "Name" property to the value above. Pass { quiet: true } to suppress this check.`
        );
      }).catch(() => {
      });
    }
    return handle;
  }

  // lib/index.js
  var plugins = {
    attribution: attributionPlugin,
    queryParams: queryParamsPlugin,
    tierMap: tierMapPlugin,
    dataLayer: dataLayerPlugin,
    fbclidResync: fbclidResyncPlugin,
    staticFields: staticFieldsPlugin,
    submitButton: submitButtonPlugin,
    redirectOnUrl: redirectOnUrlPlugin,
    serverValidation: serverValidationPlugin
  };
  var presets = { framer: framerForm };
  var utils = { cookies, querystring };
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=fairsquare-form.iife.js.map
