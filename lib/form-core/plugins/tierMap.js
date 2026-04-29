// form-core/plugins/tierMap.js
//
// Resolves the form's revenue-range field to the spec-documented
// `annualRevenueRange` enum value, accepting either authoring convention:
//
//   1. Form value IS the API enum directly (preferred for new pages)
//          <option value="$500K-$999K">$500K-$999K</option>
//      → emitted verbatim
//
//   2. Form value is a legacy internal tier code (parity with prod's
//      script.js, which used Tier codes as the canonical dropdown value)
//          <option value="Tier 2b">$500K-$999K</option>
//      → mapped via TIER_TO_REVENUE_RANGE → "$500K-$999K"
//
// Anything else is left unmapped (no emission), so a misconfigured
// dropdown surfaces as a missing-field 400 from the gateway rather than
// a silent typo.
//
// `salesDistributionTier` is the INTERNAL form-field key the library uses
// to identify the dropdown — it is NOT part of the published API contract
// and is not shipped on the wire by default. Set
// `tierField: "salesDistributionTier"` to restore the legacy parity output.

import { TIER_TO_REVENUE_RANGE, ANNUAL_REVENUE_RANGES, groupTier } from "../enums.js";

const REVENUE_TO_TIER = Object.freeze(
  Object.fromEntries(Object.entries(TIER_TO_REVENUE_RANGE).map(([tier, range]) => [range, tier]))
);
const VALID_RANGES = new Set(ANNUAL_REVENUE_RANGES);

/**
 * tierMapPlugin
 *
 * @param {object} [options]
 * @param {string}  [options.sourceField="salesDistributionTier"]
 *        The form field whose value holds either the API enum directly
 *        (e.g., "$500K-$999K") or a legacy Tier code (e.g., "Tier 2b").
 *        Internal key — not shipped on the wire by default.
 * @param {string|null} [options.tierField=null]
 *        Output key for the grouped tier value. Default `null` (do not
 *        emit). Set to a string like `"salesDistributionTier"` to enable.
 *        Reverse-resolved from the API enum when the form value was the
 *        enum string directly.
 * @param {string|null} [options.revenueRangeField="annualRevenueRange"]
 *        Output key for the API enum string. Set to `null` to omit.
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
        const raw = (values && values[sourceField]) || payload[sourceField] || "";
        if (!raw) return payload;

        // Resolve the (range, tierCode) pair regardless of which form the
        // dropdown value took. If neither matches, leave both undefined.
        let range;
        let tierCode;
        if (VALID_RANGES.has(raw)) {
          range = raw;
          tierCode = REVENUE_TO_TIER[raw];
        } else if (TIER_TO_REVENUE_RANGE[raw]) {
          range = TIER_TO_REVENUE_RANGE[raw];
          tierCode = raw;
        }

        const out = { ...payload };
        if (range && revenueRangeField) out[revenueRangeField] = range;
        if (tierCode && tierField) out[tierField] = group ? groupTier(tierCode) : tierCode;
        return out;
      };
    },
  };
};
