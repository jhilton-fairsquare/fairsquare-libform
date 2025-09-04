// form-core/adapters/dom.js (vanilla DOM adapter)
export const dom = {
  query: (selector, root = document) => root.querySelector(selector),
  on: (el, evt, fn) => el && el.addEventListener(evt, fn),
  off: (el, evt, fn) => el && el.removeEventListener(evt, fn),
  setError: (selector, message) => {
    const input = document.querySelector(selector);
    if (!input) return;
    input.classList.add("is-invalid");
    let hint = input.nextElementSibling?.classList.contains("field-error") ? input.nextElementSibling : null;
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "field-error";
      input.insertAdjacentElement("afterend", hint);
    }
    hint.textContent = message || "";
  },
  clearError: (selector) => {
    const input = document.querySelector(selector);
    if (!input) return;
    input.classList.remove("is-invalid");
    const hint = input.nextElementSibling?.classList.contains("field-error") ? input.nextElementSibling : null;
    if (hint) hint.textContent = "";
  },
  setDisabled: (selector, disabled) => {
    document.querySelectorAll(selector).forEach((el) => (el.disabled = !!disabled));
  },
};
