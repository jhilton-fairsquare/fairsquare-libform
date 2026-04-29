// form-core/plugins/attribution.js
// Bundles the spec-documented attribution fields the NF Lead Gateway
// accepts (see Field Reference → Tracking and Attribution in the
// integration guide):
//   - trackingId (Google Analytics _ga cookie)
//   - landingPage (full URL incl. query string)
//   - referrer (document.referrer)
//   - clientBrowser (user agent)
//
// Two artifacts that prod's script emitted are NOT in the API spec and
// are no longer sent by default:
//   - `nfid` — internal client identifier. We still generate + persist
//     the cookie and set `ctx.clientId` so downstream plugins (e.g., the
//     dataLayerPlugin) can reference it; we just don't ship it on the
//     wire. Opt back in with `includeNfid: true`.
//   - `path` — was the URL minus query/hash; redundant with
//     `landingPage`. Opt back in with `includePath: true`.
//
// fbclid resync against the _fbp cookie is handled separately by
// fbclidResyncPlugin and writes back into `landingPage` (the spec field).

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

const readUserAgent = () => {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
};

/**
 * attributionPlugin
 *
 * Defaults emit only the four spec-documented fields: `trackingId`,
 * `landingPage`, `referrer`, `clientBrowser`. `nfid` and `path` are
 * available as opt-in for legacy parity but are off by default because
 * neither appears in the NF Lead Gateway field reference.
 *
 * @param {object} [options]
 * @param {object} [options.clientId]      - forwarded to getOrCreateClientId
 * @param {string} [options.gaCookieName]  - cookie name for tracking id (default "_ga")
 * @param {object} [options.fields]        - rename payload keys (e.g. { trackingId: "ga_id" })
 * @param {boolean} [options.includeNfid=false]    legacy; not in API spec
 * @param {boolean} [options.includeTrackingId=true]
 * @param {boolean} [options.includeReferrer=true]
 * @param {boolean} [options.includeLandingPage=true]
 * @param {boolean} [options.includePath=false]    legacy; not in API spec
 * @param {boolean} [options.includeClientBrowser=true]
 */
export const attributionPlugin = (options = {}) => {
  const {
    clientId: clientIdOpts = {},
    gaCookieName = "_ga",
    fields = {},
    includeNfid = false,
    includeTrackingId = true,
    includeReferrer = true,
    includeLandingPage = true,
    includePath = false,
    includeClientBrowser = true,
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
    },
  };
};
