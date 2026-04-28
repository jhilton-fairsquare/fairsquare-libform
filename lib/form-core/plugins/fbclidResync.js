// form-core/plugins/fbclidResync.js
//
// Ports the prod script's updateFbclidInUrlFromCookie behavior into a
// proper async enrichment plugin.
//
// Behavior:
//   - If the current page URL has no `fbclid` query param → no-op, no delay.
//   - If `fbclid` is present, poll the `_fbp` cookie up to maxWaitMs.
//   - On the first non-empty `_fbp` read, REPLACE the value of the `fbclid`
//     URL param with the cookie value and write the resulting URL into the
//     payload (default key: `landingPage`).
//   - On timeout, leave the field as whatever upstream set (or unset).
//
// Why poll: there is no native cookie-change event in browsers, and the
// Meta Pixel script that sets `_fbp` may not have finished initializing by
// the time the user submits. Defaults match prod (≈ 3s ceiling, 150ms ticks),
// but the common case (Pixel already loaded) returns on the first poll
// with zero delay.

import { cookies } from "../../utils/cookies.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fbclidResyncPlugin
 *
 * @param {object} [options]
 * @param {string} [options.cookieName="_fbp"]   cookie to poll
 * @param {string} [options.urlParam="fbclid"]   URL query param to rewrite
 * @param {string} [options.field="landingPage"] payload key to write the resynced URL to
 * @param {number} [options.maxWaitMs=3000]      total time budget for polling
 * @param {number} [options.pollIntervalMs=150]  delay between polls
 * @param {() => string} [options.getHref]       override for the URL source (test hook)
 */
export const fbclidResyncPlugin = (options = {}) => {
  const {
    cookieName = "_fbp",
    urlParam = "fbclid",
    field = "landingPage",
    maxWaitMs = 3000,
    pollIntervalMs = 150,
    getHref,
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
      try { url = new URL(href); } catch { return payload; }
      if (!url.searchParams.has(urlParam)) return payload;

      const deadline = Date.now() + Math.max(0, maxWaitMs);
      // Try once before the first sleep — common case: cookie already set.
      const tryRead = () => cookies.get(cookieName);

      let val = tryRead();
      while (!val && Date.now() < deadline) {
        await sleep(pollIntervalMs);
        val = tryRead();
      }

      if (!val) return payload; // timeout — leave field as-is

      url.searchParams.set(urlParam, val);
      return { ...payload, [field]: url.toString() };
    },
  };
};
