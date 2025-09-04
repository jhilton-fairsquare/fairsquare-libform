// lib/form-core/plugins/queryParams.js
import { cookies } from "../../utils/cookies.js";

const DEFAULT_KEYS = [
  // common marketing params
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "gclid","gbraid","wbraid","fbclid","msclkid",
];

function readParamsFromUrl(allowed, { lowercaseKeys = true } = {}) {
  const out = {};
  const qs = new URLSearchParams(window.location.search);
  for (const [k, v] of qs.entries()) {
    const key = lowercaseKeys ? k.toLowerCase() : k;
    if (allowed.includes(key) && v != null && v !== "") out[key] = v;
  }
  return out;
}

export const queryParamsPlugin = (opts = {}) => {
  const {
    keys = DEFAULT_KEYS,            // which keys to capture
    cookieName = "utm",             // where to persist (optional)
    persistDays = 90,               // attribution window
    sameSite = "Lax",
    secure = (typeof location !== "undefined" && location.protocol === "https:"),
    includeReferrer = true,         // also capture document.referrer
    mode = "first-touch",           // "first-touch" | "last-touch" | "merge"
    canSetCookie = () => true,      // tie into your CMP if needed
    payloadField = "attribution",   // where to put it in the payload
  } = opts;

  // helper to merge against existing cookie value based on attribution model
  function combine(existing, incoming) {
    if (!existing) return incoming;
    if (mode === "last-touch") return { ...existing, ...incoming };
    if (mode === "merge")      return { ...existing, ...incoming };
    // first-touch (default): keep existing keys, only add new ones that don’t exist yet
    const out = { ...existing };
    for (const [k, v] of Object.entries(incoming)) if (out[k] == null) out[k] = v;
    return out;
  }

  return {
    init(ctx) {
      // 1) read new params from URL
      let params = readParamsFromUrl(keys.map(k => k.toLowerCase()));

      // 2) optionally include referrer
      if (includeReferrer && document.referrer) {
        params = { ...params, referrer: document.referrer };
      }

      // 3) merge with cookie (attribution model)
      const existing = cookies.getJSON(cookieName) || null;
      const merged = combine(existing, params);

      // 4) persist if we have anything new and consent allows
      if (Object.keys(merged).length && canSetCookie()) {
        cookies.setJSON(cookieName, merged, { days: persistDays, sameSite, secure, path: "/" });
      }

      // 5) wrap onSubmit so payload includes the attribution block
      const prevOnSubmit = ctx.onSubmit;
      ctx.onSubmit = (values) => {
        const base = prevOnSubmit ? prevOnSubmit(values) : values;
        const payload = base || values || {};
        // pull latest (in case cookie was set previously on another page)
        const latest = cookies.getJSON(cookieName) || merged || {};
        if (!latest || !Object.keys(latest).length) return payload;
        return { ...payload, [payloadField]: latest };
      };
    },
  };
};
