// form-core/plugins/staticFields.js
//
// Declarative per-form static fields merged into the payload.
//
// Spec-documented routing fields (NF Lead Gateway, Field Reference →
// Required Fields):
//   source    — always "NF"
//   formType  — assigned at partner onboarding, case-sensitive
//
// `journey` and `responseChannel` are NOT in the published API spec.
// Some NF deployments may consume them, but treat them as folklore until
// confirmed in writing — pass them only if you've verified your specific
// deployment requires them.
//
// IMPORTANT: client-side routing is NOT supported by the Lead Gateway —
// the gateway dispatches on `formType`. Pass through whatever the
// partner team assigned; do not derive routing decisions from form data.

/**
 * staticFieldsPlugin
 *
 * @param {Record<string, any>} statics  field name → value
 * @param {object} [options]
 * @param {"override"|"fill"} [options.mode="override"]
 *        "override" — statics win over any existing key in the payload
 *        "fill"     — only set a key when it isn't already present
 */
export const staticFieldsPlugin = (statics = {}, options = {}) => {
  const { mode = "override" } = options;

  // Strip null/undefined entries up front so we never overwrite a real
  // value with a missing one.
  const clean = {};
  for (const [k, v] of Object.entries(statics)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }

  return {
    enrich: async (payload) => {
      if (mode === "fill") {
        const out = { ...payload };
        for (const [k, v] of Object.entries(clean)) {
          if (out[k] === undefined || out[k] === null || out[k] === "") out[k] = v;
        }
        return out;
      }
      // override (default): statics are authoritative
      return { ...payload, ...clean };
    },
  };
};
