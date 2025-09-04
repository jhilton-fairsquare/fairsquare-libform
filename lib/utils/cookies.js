// lib/utils/cookies.js
// Tiny cookie utility with encoding, SameSite, expiry, and JSON helpers.

export const cookies = {
  get(name) {
    const nameEQ = encodeURIComponent(name) + "=";
    const parts = document.cookie ? document.cookie.split(";") : [];
    for (let c of parts) {
      c = c.trim();
      if (c.indexOf(nameEQ) === 0) {
        try {
          return decodeURIComponent(c.substring(nameEQ.length));
        } catch {
          return c.substring(nameEQ.length);
        }
      }
    }
    return null;
  },

  set(name, value, opts = {}) {
    const {
      // Expiration can be { days: 365 } or a Date via `expires`
      days,
      expires,
      path = "/",
      domain,
      secure = false,
      sameSite = "Lax", // "Lax" | "Strict" | "None"
    } = opts;

    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

    let exp = expires;
    if (!exp && Number.isFinite(days)) {
      const d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      exp = d;
    }
    if (exp instanceof Date) cookie += `; Expires=${exp.toUTCString()}`;

    if (path) cookie += `; Path=${path}`;
    if (domain) cookie += `; Domain=${domain}`;
    if (secure) cookie += `; Secure`;
    if (sameSite) cookie += `; SameSite=${sameSite}`;

    document.cookie = cookie;
    return true;
  },

  remove(name, opts = {}) {
    const { path = "/", domain } = opts;
    const d = new Date(0);
    let cookie = `${encodeURIComponent(name)}=; Expires=${d.toUTCString()}`;
    if (path) cookie += `; Path=${path}`;
    if (domain) cookie += `; Domain=${domain}`;
    document.cookie = cookie;
    return true;
  },

  has(name) {
    return this.get(name) != null;
  },

  getJSON(name) {
    const v = this.get(name);
    if (!v) return null;
    try { return JSON.parse(v); } catch { return null; }
  },

  setJSON(name, obj, opts) {
    return this.set(name, JSON.stringify(obj), opts);
  },
};