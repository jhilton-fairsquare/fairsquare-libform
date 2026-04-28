// form-core/enums.js
//
// Canonical NF Lead Gateway enum values. Pin these as constants so consumers
// don't typo a string the API will reject. Strings are exact-match,
// case-sensitive (per the integration guide).

export const ANNUAL_REVENUE_RANGES = Object.freeze([
  "Under $120K",
  "$120K-$249K",
  "$250K-$499K",
  "$500K-$999K",
  "Over $1M",
]);

export const ENTITY_TYPES = Object.freeze([
  "Sole Proprietorship",
  "Partnership",
  "S Corp",
  "C Corp",
  "LLC",
]);

export const CREDIT_RATINGS = Object.freeze(["Excellent", "Good", "Fair", "Poor"]);

// Lead Gateway response channel — only enum-validated routing field.
export const RESPONSE_CHANNELS = Object.freeze(["Internet", "Internet-PURL"]);

export const INDUSTRIES = Object.freeze([
  "Administrative Support",
  "Agriculture",
  "Arts Entertainment and Recreation",
  "Auto Repair",
  "Commercial Trucking",
  "Construction",
  "Educational Services",
  "Finance and Insurance",
  "Healthcare and Social Assistance",
  "Landscaping",
  "Manufacturing",
  "Medical Practice",
  "Mining",
  "Professional Scientific and Technical Services",
  "Public Administration",
  "Real Estate and Leasing",
  "Restaurants and Food Services",
  "Retail",
  "Utilities",
  "Wholesale Trade",
  "Other",
]);

// Internal tier code → public-facing API enum value.
// Mirrors the prod script's tierToRevenue table.
export const TIER_TO_REVENUE_RANGE = Object.freeze({
  "Tier 1a": "Under $120K",
  "Tier 1b": "$120K-$249K",
  "Tier 2a": "$250K-$499K",
  "Tier 2b": "$500K-$999K",
  "Tier 3":  "Over $1M",
});

// Tier code grouping (1a/1b → 1; 2a/2b → 2). Prod sends the grouped value.
export const groupTier = (tier) => {
  if (typeof tier !== "string") return "";
  return tier.replace(/\bTier 1[ab]\b/, "Tier 1").replace(/\bTier 2[ab]\b/, "Tier 2");
};

// Validators built on top of these enums. Drop into a `validate: oneOf(...)`.
export const oneOf = (allowed, msg) => async (value) => {
  const s = value == null ? "" : String(value);
  return allowed.includes(s)
    ? { valid: true, message: "" }
    : { valid: false, message: msg || `Must be one of: ${allowed.join(", ")}` };
};
