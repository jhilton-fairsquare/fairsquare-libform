// form-core/adapters/transport.js
//
// JSON transport tuned for the National Funding Lead Gateway response shape:
//   200 success:        { success: true, url }
//   400 validation:     { success: false, message, fields }
//   400 missing fields: { success: false, message, missingFields, url? }
//   500 server error:   { success: false, message, url? }
//
// On non-2xx the transport throws a TransportError that carries the parsed
// body so plugins (redirectOnUrl, validation surfacers) can react to it.

export class TransportError extends Error {
  constructor({ status, body, url, message }) {
    super(message || `Submit failed (${status})`);
    this.name = "TransportError";
    this.status = status;
    this.body = body;       // parsed response body (object) when JSON, else raw text
    this.url = url;         // body.url if present (fallback redirect target)
  }
}

const parseBody = async (res) => {
  const ct = res.headers?.get?.("content-type") || "";
  if (ct.includes("application/json")) {
    try { return await res.json(); } catch { return null; }
  }
  try { return await res.text(); } catch { return null; }
};

/**
 * transport
 *
 * @param {string} endpoint
 * @param {object} [options]
 * @param {object} [options.headers]                extra request headers
 * @param {number} [options.timeoutMs=15000]        request timeout
 * @param {RequestCredentials} [options.credentials="omit"]
 *        defaults to "omit" so first-party cookies don't leak cross-origin
 * @param {(payload, ctx) => string|null} [options.idempotencyKey]
 *        supply a stable per-submission key (e.g., () => ctx.clientId)
 *        attached as the `Idempotency-Key` request header
 * @param {(payload, ctx) => object} [options.transformPayload]
 *        last-mile shape transformation (e.g., add formId)
 */
export const transport = (endpoint, options = {}) => {
  const {
    headers = {},
    timeoutMs = 15000,
    credentials = "omit",
    idempotencyKey,
    transformPayload,
  } = options;

  return {
    async send(payload, ctx) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller && timeoutMs
        ? setTimeout(() => controller.abort(new Error("Submit timed out")), timeoutMs)
        : null;

      const finalPayload = transformPayload ? transformPayload(payload, ctx) : payload;

      const reqHeaders = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      };
      if (idempotencyKey) {
        try {
          const key = idempotencyKey(finalPayload, ctx);
          if (key) reqHeaders["Idempotency-Key"] = key;
        } catch { /* ignore */ }
      }

      let res;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          credentials,
          headers: reqHeaders,
          body: JSON.stringify(finalPayload),
          signal: controller?.signal,
        });
      } catch (err) {
        if (timer) clearTimeout(timer);
        // Network failure or abort — no parsed body / status
        throw new TransportError({
          status: 0,
          body: null,
          url: null,
          message: err?.message || "Network error",
        });
      } finally {
        if (timer) clearTimeout(timer);
      }

      const body = await parseBody(res);
      const url = (body && typeof body === "object" && body.url) || null;

      if (!res.ok) {
        throw new TransportError({
          status: res.status,
          body,
          url,
          message:
            (body && typeof body === "object" && body.message) ||
            (typeof body === "string" && body) ||
            res.statusText ||
            `Submit failed (${res.status})`,
        });
      }

      // 2xx: prefer JSON body; fall back to {} so consumers can rely on truthiness.
      return body && typeof body === "object" ? body : {};
    },
  };
};
