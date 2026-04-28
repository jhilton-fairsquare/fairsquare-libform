// form-core/plugins/redirectOnUrl.js
//
// Implements the National Funding Lead Gateway redirect contract:
//
//   200 success         → redirect to res.url        (lead accepted)
//   400 validation      → no redirect by default     (let UI surface field errors)
//   400 missing fields  → redirect to err.url if set (fallback to standard form)
//   500 server error    → redirect to err.url if set (fallback to standard form)
//
// Behavior is configurable. Plugin runs LAST so consumers' onSuccess/onError
// fire first (e.g., to log analytics) before navigation.

const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

const navigate = (url) => {
  if (typeof window === "undefined" || !window.location) return;
  window.location.href = url;
};

/**
 * redirectOnUrlPlugin
 *
 * @param {object} [options]
 * @param {boolean} [options.onSuccess=true]     redirect on 200 res.url
 * @param {boolean} [options.onMissingFields=true] redirect on 400 missingFields w/ url
 * @param {boolean} [options.onServerError=true] redirect on 500 w/ url
 * @param {boolean} [options.onValidationError=false] redirect on 400 fields w/ url
 *        Default false: keep the user on the form so inline errors are visible.
 * @param {(url: string, ctx) => string} [options.transformUrl] last-mile URL rewrite
 *        (e.g., append additional query params)
 * @param {(url: string) => void} [options.navigate] override the navigation
 *        side-effect (useful for tests or SPA routing)
 */
export const redirectOnUrlPlugin = (options = {}) => {
  const {
    onSuccess: redirectOnSuccess = true,
    onMissingFields = true,
    onServerError = true,
    onValidationError = false,
    transformUrl,
    navigate: nav = navigate,
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
      // err is a TransportError: { status, body, url, message }
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
        if (isMissing && onMissingFields) { go(url, ctx); return; }
        if (isValidation && onValidationError) { go(url, ctx); return; }
      }
    },
  };
};
