// form-core/plugins/attribution.js
// Bundles the attribution fields prod's script collected in one shot:
//   - NFID (cookie-persisted client id, crypto-strong)
//   - trackingId (Google Analytics _ga cookie)
//   - landingPage (full URL incl. query string)
//   - path (URL minus query/hash)
//   - referrer (document.referrer)
//
// fbclid resync against the _fbp cookie is intentionally NOT included here;
// it requires async enrichment, which lands with the lifecycle pipeline (Phase 1.5).

import { cookies } from "../../utils/cookies.js";
import { getOrCreateClientId } from "../../utils/id.js";

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const readPath = () => {
  const w = safeWindow();
  if (!w?.location) return "";
  return w.location.href.split("?")[0].split("#")[0];
};

const readLandingPage = () => {
  const w = safeWindow();
  return w?.location?.href || "";
};

const readReferrer = () => {
  if (typeof document === "undefined") return "";
  return document.referrer || "";
};

/**
 * attributionPlugin
 *
 * @param {object} [options]
 * @param {object} [options.clientId]      - forwarded to getOrCreateClientId
 * @param {string} [options.gaCookieName]  - cookie name for tracking id (default "_ga")
 * @param {object} [options.fields]        - rename payload keys (e.g. { trackingId: "ga_id" })
 * @param {boolean} [options.includeReferrer] - default true
 * @param {boolean} [options.includeLandingPage] - default true
 * @param {boolean} [options.includePath] - default true
 */
export const attributionPlugin = (options = {}) => {
  const {
    clientId: clientIdOpts = {},
    gaCookieName = "_ga",
    fields = {},
    includeReferrer = true,
    includeLandingPage = true,
    includePath = true,
  } = options;

  const key = (k) => fields[k] || k;

  return {
    init(ctx) {
      const nfid = getOrCreateClientId(clientIdOpts);
      ctx.clientId = nfid;

      const enrich = () => {
        const out = { [key("nfid")]: nfid };
        const ga = cookies.get(gaCookieName);
        if (ga) out[key("trackingId")] = ga;
        if (includeLandingPage) out[key("landingPage")] = readLandingPage();
        if (includePath) out[key("path")] = readPath();
        if (includeReferrer) out[key("referrer")] = readReferrer();
        return out;
      };

      const prev = ctx.onSubmit;
      ctx.onSubmit = (values) => {
        const base = prev ? prev(values) : values;
        const payload = base || values || {};
        return { ...payload, ...enrich() };
      };
    },
  };
};
