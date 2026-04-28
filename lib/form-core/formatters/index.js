// form-core/formatters/index.js
// Pure functions: (raw: string) => formatted: string.
// Bound via FormController on `input` events when `field.format` is set.

const toStr = (v) => (v == null ? "" : String(v));

/**
 * formatPhoneUS
 * 1234567 → "123-456-7"
 * 1234567890 → "123-456-7890"
 * Strips non-digits, caps at 10 digits.
 */
export const formatPhoneUS = (raw) => {
  const digits = toStr(raw).replace(/\D/g, "").slice(0, 10);
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length >= 4) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
  }
  return digits;
};

/**
 * formatZipUS
 * Strips non-digits, caps at 5 digits.
 */
export const formatZipUS = (raw) => toStr(raw).replace(/\D/g, "").slice(0, 5);

/**
 * stripDashes — handy when serializing a formatted phone for the wire.
 */
export const stripDashes = (raw) => toStr(raw).replace(/-/g, "");
