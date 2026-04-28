// lib/index.js
//
// Public API for both ESM consumers and the IIFE bundle (window.FairsquareForm).
// Keep this surface small and explicit — anything exposed here is a contract.

export { createForm } from "./FormFactory.js";
export { TransportError } from "./form-core/adapters/transport.js";

// Validators, formatters, and enums are namespaced so callers write
// FairsquareForm.validators.required() rather than juggling 30 globals.
export * as validators from "./form-core/validators/index.js";
export * as formatters from "./form-core/formatters/index.js";
export * as enums from "./form-core/enums.js";

// Plugins live behind a single map; each entry is a factory function.
import { attributionPlugin } from "./form-core/plugins/attribution.js";
import { queryParamsPlugin } from "./form-core/plugins/queryParams.js";
import { tierMapPlugin } from "./form-core/plugins/tierMap.js";
import { dataLayerPlugin, sources as dataLayerSources } from "./form-core/plugins/dataLayer.js";
import { fbclidResyncPlugin } from "./form-core/plugins/fbclidResync.js";
import { staticFieldsPlugin } from "./form-core/plugins/staticFields.js";
import { submitButtonPlugin } from "./form-core/plugins/submitButton.js";
import { redirectOnUrlPlugin } from "./form-core/plugins/redirectOnUrl.js";
import { serverValidationPlugin } from "./form-core/plugins/serverValidation.js";

export const plugins = {
  attribution: attributionPlugin,
  queryParams: queryParamsPlugin,
  tierMap: tierMapPlugin,
  dataLayer: dataLayerPlugin,
  fbclidResync: fbclidResyncPlugin,
  staticFields: staticFieldsPlugin,
  submitButton: submitButtonPlugin,
  redirectOnUrl: redirectOnUrlPlugin,
  serverValidation: serverValidationPlugin,
};

// Helpers exposed top-level for ergonomic access.
export { dataLayerSources };

// Low-level utilities. Most consumers won't need these, but they're useful
// for custom plugins.
import { cookies } from "./utils/cookies.js";
import { querystring } from "./utils/querystring.js";
export const utils = { cookies, querystring };
