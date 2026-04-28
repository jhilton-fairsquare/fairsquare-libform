// tests/setup.js
// jsdom doesn't ship URL.canParse and a few niceties; nothing global needed today.
// Reset cookies between tests.
import { afterEach } from "vitest";

afterEach(() => {
  if (typeof document === "undefined") return;
  // Clear all cookies on the current document
  document.cookie.split(";").forEach((c) => {
    const eq = c.indexOf("=");
    const name = (eq > -1 ? c.slice(0, eq) : c).trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
});
