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
export const required = (msg = "This field is required") => async (value) => {
  const s = toStr(value).trim();
  console.log(msg);
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
