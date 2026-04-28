// lib/utils/querystring.js
// URL query-string helpers. Reads `window.location.search` lazily so
// callers see the current URL even if it was rewritten after script load.

const params = () => new URLSearchParams(
  typeof window !== "undefined" && window.location ? window.location.search : ""
);

export const querystring = {
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
  },
};
