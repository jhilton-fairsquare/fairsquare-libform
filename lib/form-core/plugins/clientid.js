// lib/form-core/plugins/clientId.js
// Ensures a stable clientId (from cookie) and injects it into submit payloads.

import { getOrCreateClientId } from "../../utils/id.js";

export const clientIdPlugin = (options = {}) => ({
  init(ctx) {
    const clientId = getOrCreateClientId(options);
    // expose for debugging
    ctx.clientId = clientId;

    // Wrap existing onSubmit so clientId is always included
    const prevOnSubmit = ctx.onSubmit;
    ctx.onSubmit = (values) => {
      const base = prevOnSubmit ? prevOnSubmit(values) : values;
      const payload = base || values || {};
      return { clientId, ...payload };
    };
  }
});
