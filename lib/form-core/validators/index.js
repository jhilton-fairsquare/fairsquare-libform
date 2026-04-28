// ---- shared helpers ----
const ok = () => ({ valid: true, message: "" });
const fail = (message) => ({ valid: false, message });

// Field-agnostic coercion to string
const toStr = (v) => {
  if (v == null) return "";
  const t = typeof v;
  if (t === "string") return v;
  if (t === "number" || t === "boolean") return String(v);

  if (t === "object") {
    // Duck-type DOM-like
    if ("value" in v && (typeof v.value === "string" || typeof v.value === "number" || typeof v.value === "boolean")) {
      return String(v.value);
    }
    // Single-key primitive object e.g., { firstName: "Ada" }
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const val = v[keys[0]];
      if (["string", "number", "boolean"].includes(typeof val)) return String(val);
    }
    // Arrays -> join
    if (Array.isArray(v)) return v.map(toStr).filter(Boolean).join(",");

    // Respect meaningful toString
    const s = v.toString?.();
    if (typeof s === "string" && s !== "[object Object]") return s;
    return "";
  }
  return "";
};

// ---- composition ----
export const all = (...validators) => async (value, values) => {
  for (const v of validators) {
    const res = await v(value, values);
    if (!res.valid) return res;
  }
  return ok();
};
export const any = (...validators) => async (value, values) => {
  let lastMsg = "";
  for (const v of validators) {
    const res = await v(value, values);
    if (res.valid) return ok();
    lastMsg = res.message || lastMsg;
  }
  return fail(lastMsg || "Invalid value");
};

// ---- validators ----
export const required = (msg = "This field is required. Snap to it.") => async (value) => {
  const s = toStr(value).trim();
  return s ? ok() : fail(msg);
};

export const email = (msg = "Please enter a valid email address.") => async (value) => {
  const s = toStr(value).trim();
  if (!s) return fail(msg);
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  return okEmail ? ok() : fail(msg);
};

export const fullName = (msg = "Please enter your first and last name.") => async (value) => {
  const s = toStr(value).trim();
  const parts = s.split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? ok() : fail(msg);
};

export const minLength = (n, msg = `Must be at least ${n} characters`) => async (value) => {
  const s = toStr(value);
  return s.length >= n ? ok() : fail(msg);
};

export const maxLength = (n, msg = `Must be at most ${n} characters`) => async (value) => {
  const s = toStr(value);
  return s.length <= n ? ok() : fail(msg);
};

export const pattern = (re, msg = "Invalid format") => async (value) => {
  const s = toStr(value);
  return re.test(s) ? ok() : fail(msg);
};

export const phoneBasic = (msg = "Please enter a valid phone number.") => async (value) => {
  const s = toStr(value).trim();
  return /^\+?[0-9\s\-()]{7,15}$/.test(s) ? ok() : fail(msg);
};

export const phoneDashedUS = (
  msg = "Please enter a valid phone number (e.g., 123-456-7890)."
) => async (value) => {
  const s = toStr(value).trim();
  return /^\d{3}-\d{3}-\d{4}$/.test(s) ? ok() : fail(msg);
};

// Stricter US phone: rejects 0/1 area codes, allows ' ' or '-' separators.
// Mirrors prod script's PHONE_REGEX after the 10-digit auto-formatter runs.
export const phoneUS = (
  msg = "Please enter a valid phone number (###-###-####)."
) => async (value) => {
  const s = toStr(value).trim();
  return /^\s*[2-9]\d{2}[ -]?\d{3}[ -]?\d{4}\s*$/.test(s) ? ok() : fail(msg);
};

// US ZIP: 5-digit, reject all zeros, reject impossible ranges.
// Range bounds (501..99950) match prod script.
export const zipUS = (msg) => async (value) => {
  const s = toStr(value).trim();
  const base = s.slice(0, 5);
  if (!/^\d{5}$/.test(base)) {
    return fail(msg || "Please enter a valid 5-digit ZIP code (e.g., 12345).");
  }
  if (base === "00000") {
    return fail(msg || "ZIP code cannot be all zeros.");
  }
  const n = parseInt(base, 10);
  if (n < 501 || n > 99950) {
    return fail(msg || "Please enter a valid U.S. ZIP code.");
  }
  return ok();
};

// Strict email: rejects ".." and duplicate trailing labels (e.g., foo@bar.com.com).
// Matches prod script's email validation step-for-step.
export const emailStrict = (
  msg = "Please enter a valid email address."
) => async (value) => {
  const s = toStr(value).trim();
  if (!s) return fail(msg);
  const re = /^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
  if (!re.test(s)) return fail(msg);
  if (/\.\./.test(s)) return fail(msg);
  const domain = (s.split("@")[1] || "").replace(/\.$/, "").toLowerCase();
  const labels = domain.split(".");
  if (labels.length >= 2 && labels[labels.length - 1] === labels[labels.length - 2]) {
    return fail(msg);
  }
  return ok();
};

// Letters with optional hyphenated parts and spaces between words.
// Matches prod first/last/business name regex.
export const lettersHyphenSpaces = (
  msg = "Please use letters only."
) => async (value) => {
  const s = toStr(value).trim();
  return /^[A-Za-z]+(?:-[A-Za-z]+)*(?: [A-Za-z]+(?:-[A-Za-z]+)*)*$/.test(s)
    ? ok()
    : fail(msg);
};

// Strict full name: 2+ space-separated parts, letters only.
// Matches prod fullName regex.
export const fullNameLettersOnly = (
  msg = "Please enter your first and last name using letters only."
) => async (value) => {
  const s = toStr(value).trim();
  return /^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(s) ? ok() : fail(msg);
};

export const requiredSelect = (msg = "Please select an option.") => async (value) => {
  const s = toStr(value).trim();
  return s ? ok() : fail(msg);
};

export const mustAccept = (msg = "You must accept the privacy policy.") => async (value) => {
  if (value === true) return ok();
  const s = toStr(value).toLowerCase();
  return s === "true" || s === "on" || s === "1" || s === "yes" ? ok() : fail(msg);
};

// Expose for testing
export const __testing = { toStr };
