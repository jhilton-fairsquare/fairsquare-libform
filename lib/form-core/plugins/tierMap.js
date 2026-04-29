// form-core/plugins/tierMap.js
//
// Translates an internal tier code (e.g. "Tier 2a") into the canonical
// `annualRevenueRange` enum value the NF Lead Gateway expects.
//
// `salesDistributionTier` is the INTERNAL form-field key the library uses
// to identify the revenue-range dropdown — it is *not* part of the
// published API contract (NF Lead Gateway v1, see Field Reference in the
// integration guide). By default this plugin no longer emits it on the
// wire; only the spec-documented `annualRevenueRange` is shipped.
// To restore the legacy parity output (e.g., a deployment that consumes
// the grouped tier value internally), set `tierField: "salesDistributionTier"`.

import { TIER_TO_REVENUE_RANGE, groupTier } from "../enums.js";

/**
 * tierMapPlugin
 *
 * @param {object} [options]
 * @param {string}  [options.sourceField="salesDistributionTier"]
 *        The form field whose value holds the tier code (e.g., "Tier 2a").
 *        This is an internal key — it never has to leave the library.
 * @param {string|null} [options.tierField=null]
 *        Output key for the grouped tier value. Default is `null` (do not
 *        emit). Set to `"salesDistributionTier"` (or any other name) to
 *        re-enable the legacy parity output.
 * @param {string|null} [options.revenueRangeField="annualRevenueRange"]
 *        Output key for the resolved API enum string. Set to `null` to omit.
 * @param {boolean} [options.group=true]
 *        If true, emit grouped tier (Tier 2a/2b → Tier 2). If false, pass
 *        the raw tier code through. Only applies when `tierField` is set.
 */
export const tierMapPlugin = (options = {}) => {
  const {
    sourceField = "salesDistributionTier",
    tierField = null,
    revenueRangeField = "annualRevenueRange",
    group = true,
  } = options;

  return {
    init(ctx) {
      const prev = ctx.onSubmit;
      ctx.onSubmit = (values) => {
        const base = prev ? prev(values) : values;
        const payload = base || values || {};
        const tier = (values && values[sourceField]) || payload[sourceField] || "";

        const out = { ...payload };
        if (tier) {
          if (tierField) out[tierField] = group ? groupTier(tier) : tier;
          if (revenueRangeField) {
            const range = TIER_TO_REVENUE_RANGE[tier];
            if (range) out[revenueRangeField] = range;
          }
        }
        return out;
      };
    },
  };
};
