// form-core/adapters/dom.js (vanilla DOM adapter)
//
// Renders inline errors via textContent (no innerHTML) so server-supplied
// strings cannot escape into markup.

const errorContainerFor = (input) => {
  if (!input) return null;
  if (input.type === "checkbox" || input.type === "radio") {
    return input.closest("label") || input.parentElement || input;
  }
  return input.closest(".field, [data-field], div") || input.parentElement || input;
};

const findOrCreateHint = (anchor) => {
  if (!anchor || !anchor.parentNode) return null;
  const sib = anchor.nextElementSibling;
  if (sib && sib.classList?.contains("field-error")) return sib;
  const hint = document.createElement("div");
  hint.className = "field-error";
  anchor.parentNode.insertBefore(hint, anchor.nextSibling);
  return hint;
};

export const dom = {
  query: (selector, root = document) => (root || document).querySelector(selector),
  queryAll: (selector, root = document) => Array.from((root || document).querySelectorAll(selector)),
  on: (el, evt, fn, opts) => el && el.addEventListener(evt, fn, opts),
  off: (el, evt, fn, opts) => el && el.removeEventListener(evt, fn, opts),

  setError: (selector, message) => {
    const input = document.querySelector(selector);
    if (!input) return;
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    const anchor = errorContainerFor(input);
    const hint = findOrCreateHint(anchor);
    if (hint) hint.textContent = message || "";
  },

  clearError: (selector) => {
    const input = document.querySelector(selector);
    if (!input) return;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    const anchor = errorContainerFor(input);
    if (!anchor) return;
    const sib = anchor.nextElementSibling;
    if (sib && sib.classList?.contains("field-error")) sib.remove();
  },

  setDisabled: (selector, disabled) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.disabled = !!disabled;
      if (disabled) el.setAttribute("aria-busy", "true");
      else el.removeAttribute("aria-busy");
    });
  },
};
