// lib/utils/id.js
// Crypto-strong helpers + legacy-compatible NFID and cookie persistence.

import { cookies } from "./cookies.js";

const hasCrypto =
  typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";

function randByte() {
  if (hasCrypto) {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  return Math.floor(Math.random() * 256);
}

function randNibble() {
  return randByte() & 0x0f;
}

// RFC4122-style variant nibble (10xx -> values 8..b)
function variantNibble() {
  const r = randNibble();
  return (r & 0x3) | 0x8;
}

export function hex(n) {
  let out = "";
  for (let i = 0; i < n; i++) out += (randByte() & 0xff).toString(16).padStart(2, "0");
  return out;
}

/**
 * generateNFID
 * Legacy-compatible by default: "NFID-yxxxxxxxxxxxx"
 *  - 'x' = random hex nibble
 *  - 'y' = RFC4122 variant nibble (8..b)
 */
export function generateNFID(pattern = "NFID-yxxxxxxxxxxxx") {
  return pattern.replace(/[xy]/g, (c) => {
    const v = c === "x" ? randNibble() : variantNibble();
    return v.toString(16);
  });
}

/**
 * getOrCreateClientId
 * Reads from cookie; if missing, generates via generateNFID() and persists.
 */
export function getOrCreateClientId({
  cookieName = "nfid",
  pattern = "NFID-yxxxxxxxxxxxx",
  persistDays = 365,
  sameSite = "Lax",
  secure = false,
  path = "/",
  domain,
  // Optional consent hook: return false to avoid setting cookie
  canSetCookie = () => true,
} = {}) {
  const existing = cookies.get(cookieName);
  if (existing) return existing;
  const id = generateNFID(pattern);
  if (canSetCookie()) {
    cookies.set(cookieName, id, { days: persistDays, sameSite, secure, path, domain });
  }
  return id;
}
