// form-core/plugins/serverValidation.js
//
// Surfaces server-side validation errors from a 400 response body of shape
//   { success: false, message, fields: ["email", "phone"] }
// onto the matching form fields via controller.setFieldErrors().
//
// Pair with redirectOnUrlPlugin: that one handles missing-field/server-error
// fallbacks, this one keeps users on the page when fields fail validation.

const DEFAULT_MESSAGES = {
  email: "That email looks invalid. Please check and try again.",
  phone: "That phone number looks invalid. Please check and try again.",
  zipCode: "That ZIP code looks invalid. Please check and try again.",
  state: "Please use a 2-letter state code.",
};

/**
 * serverValidationPlugin
 *
 * @param {object} [options]
 * @param {Record<string,string>} [options.messages]
 *        Map of API field name → user-facing message. Defaults to a small
 *        starter map; merged with the user's overrides.
 * @param {Record<string,string>} [options.fieldNameMap]
 *        Optional API field → form field name map, when the names differ
 *        (e.g., { phone: "phoneNumber", zipCode: "businessZipcode" }).
 * @param {string} [options.fallbackMessage]
 *        Used for any field that has no specific message.
 */
export const serverValidationPlugin = (options = {}) => {
  const {
    messages = {},
    fieldNameMap = {},
    fallbackMessage = "Please check this field and try again.",
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
    },
  };
};
