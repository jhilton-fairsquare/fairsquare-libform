// form-core/plugins/queryParams.js
//
// Captures URL query-string params and writes them into the submission
// payload using the canonical NF Lead Gateway field names.
//
// Default mapping (URL key → payload key) — every entry corresponds to a
// field documented in the NF Lead Gateway spec (Field Reference →
// Tracking and Attribution):
//   utm_source   → utmSource
//   utm_medium   → utmMedium
//   utm_campaign → utmCampaign
//   utm_content  → utmContent
//   utm_term     → utmTerm
//   utm_id       → utmId
//   gclid        → gclid
//   fbclid       → fbclid
//   msclkid      → msclkid
//
// `gclsrc` (Google click source) used to be in this map for parity with
// prod's script.js, but the NF API doesn't document it — removed.
// Override or extend via the `map`/`extraMap` options:
//   queryParamsPlugin({ extraMap: { partnerCode: "partnerCode" } })

import { querystring } from "../../utils/querystring.js";

const DEFAULT_MAP = Object.freeze({
  utm_source:   "utmSource",
  utm_medium:   "utmMedium",
  utm_campaign: "utmCampaign",
  utm_content:  "utmContent",
  utm_term:     "utmTerm",
  utm_id:       "utmId",
  gclid:        "gclid",
  fbclid:       "fbclid",
  msclkid:      "msclkid",
});

/**
 * queryParamsPlugin
 *
 * @param {object} [options]
 * @param {Record<string,string>} [options.map] URL key → payload key. Replaces defaults.
 * @param {Record<string,string>} [options.extraMap] URL key → payload key, merged with defaults.
 * @param {boolean} [options.useDefaults=true] include the canonical default mapping
 * @param {string} [options.namespace] if set, nests captured params under this key
 *        instead of writing them top-level (back-compat with previous `attrs` behavior)
 */
export const queryParamsPlugin = (options = {}) => {
  const { map, extraMap = {}, useDefaults = true, namespace } = options;

  const finalMap = map ? { ...map } : (useDefaults ? { ...DEFAULT_MAP, ...extraMap } : { ...extraMap });

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
        if (namespace) return { ...payload, [namespace]: { ...(payload[namespace] || {}), ...captured } };
        return { ...payload, ...captured };
      };
    },
  };
};
