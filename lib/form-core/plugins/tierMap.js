// form-core/plugins/tierMap.js
//
// Translates an internal tier code (e.g. "Tier 2a") into the canonical
// `annualRevenueRange` enum value the NF Lead Gateway expects, and
// optionally writes a grouped tier code (e.g. "Tier 2") to the payload.
//
// Mirrors the prod script's behavior:
//   - SalesDistributionTier  → grouped tier ("Tier 1a/1b" -> "Tier 1", etc.)
//   - AnnualRevenueRange     → tierToRevenue[tier].range

import { TIER_TO_REVENUE_RANGE, groupTier } from "../enums.js";

/**
 * tierMapPlugin
 *
 * @param {object} [options]
 * @param {string} [options.sourceField="salesDistributionTier"]
 *        The form field whose value holds the tier code (e.g., "Tier 2a").
 * @param {string} [options.tierField="salesDistributionTier"]
 *        Output key for the grouped tier value. Set to null to omit.
 * @param {string} [options.revenueRangeField="annualRevenueRange"]
 *        Output key for the resolved enum string. Set to null to omit.
 * @param {boolean} [options.group=true]
 *        If true, emit grouped tier (Tier 2a/2b → Tier 2). If false, pass
 *        the raw tier code through.
 */
export const tierMapPlugin = (options = {}) => {
  const {
    sourceField = "salesDistributionTier",
    tierField = "salesDistributionTier",
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
