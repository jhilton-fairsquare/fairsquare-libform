// form-core/plugins/submitButton.js
// Injects a CSS spinner into the submit button while the request is in flight,
// hides any leading SVG/icon for the duration, and toggles aria-busy.
//
// Uses the controller's onBeforeSend / onAfterSend plugin hooks, so the
// spinner only appears once validation has passed.

const SPINNER_CLASS = "libform-spinner";
const STYLE_ID = "libform-submit-button-styles";

const injectStylesOnce = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${SPINNER_CLASS} {
      box-sizing: border-box;
      display: inline-block;
      vertical-align: middle;
      width: 16px;
      height: 16px;
      margin-left: 8px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: libform-spin 0.6s linear infinite;
    }
    @keyframes libform-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
};

const findButton = (ctx) => {
  if (typeof document === "undefined") return null;
  return document.querySelector(`${ctx.formSelector} [type="submit"]`);
};

const start = (ctx, iconSelector) => {
  const btn = findButton(ctx);
  if (!btn) return;
  btn.setAttribute("aria-busy", "true");
  if (iconSelector) {
    btn.querySelectorAll(iconSelector).forEach((el) => {
      el.dataset.libformPrevDisplay = el.style.display || "";
      el.style.display = "none";
    });
  }
  if (!btn.querySelector(`.${SPINNER_CLASS}`)) {
    const spinner = document.createElement("span");
    spinner.className = SPINNER_CLASS;
    spinner.setAttribute("aria-hidden", "true");
    btn.appendChild(spinner);
  }
};

const stop = (ctx, iconSelector) => {
  const btn = findButton(ctx);
  if (!btn) return;
  btn.removeAttribute("aria-busy");
  btn.querySelectorAll(`.${SPINNER_CLASS}`).forEach((el) => el.remove());
  if (iconSelector) {
    btn.querySelectorAll(iconSelector).forEach((el) => {
      const prev = el.dataset.libformPrevDisplay;
      el.style.display = prev ?? "";
      delete el.dataset.libformPrevDisplay;
    });
  }
};

/**
 * submitButtonPlugin
 *
 * @param {object} [options]
 * @param {string} [options.iconSelector="svg"]   selector inside the button to hide while loading
 * @param {boolean} [options.injectStyles=true]   skip if the host site provides its own
 */
export const submitButtonPlugin = (options = {}) => {
  const { iconSelector = "svg", injectStyles = true } = options;

  return {
    init() {
      if (injectStyles) injectStylesOnce();
    },
    onBeforeSend(_payload, ctx) {
      start(ctx, iconSelector);
    },
    onAfterSend(_outcome, ctx) {
      stop(ctx, iconSelector);
    },
  };
};
