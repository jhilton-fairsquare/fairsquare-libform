// form-core/mount.js
// Wait-for-DOM helpers for hosts (Framer, Webflow, SPAs) that mount
// the form *after* the script tag executes.

const docReady = () =>
  typeof document !== "undefined" &&
  (document.readyState === "interactive" || document.readyState === "complete");

const onceReady = (fn) => {
  if (docReady()) {
    fn();
    return;
  }
  document.addEventListener("DOMContentLoaded", fn, { once: true });
};

/**
 * waitForElement
 * Resolves when a node matching `selector` exists, or rejects on timeout.
 * @param {string} selector
 * @param {{ timeout?: number, root?: ParentNode }} [opts]
 * @returns {Promise<Element>}
 */
export function waitForElement(selector, { timeout = 10000, root } = {}) {
  return new Promise((resolve, reject) => {
    const target = root || (typeof document !== "undefined" ? document : null);
    if (!target) return reject(new Error("waitForElement: no document"));

    const found = target.querySelector(selector);
    if (found) return resolve(found);

    let observer;
    const timer = setTimeout(() => {
      observer?.disconnect();
      reject(new Error(`waitForElement: timeout for ${selector}`));
    }, timeout);

    observer = new MutationObserver(() => {
      const el = target.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(target === document ? document.body : target, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * mount
 * Runs `setup` after the form node exists. Optionally observes the document
 * and re-invokes `setup` when the form is replaced (Framer hot-swap).
 *
 * @param {string} selector  - selector for the form root (e.g. `[data-form="id"]`)
 * @param {(formEl: Element) => void | (() => void)} setup - returns optional cleanup
 * @param {{ timeout?: number, watchReplacement?: boolean }} [opts]
 * @returns {Promise<{ stop: () => void }>}
 */
export async function mount(selector, setup, opts = {}) {
  const { timeout = 10000, watchReplacement = false } = opts;

  await new Promise((res) => onceReady(res));

  let cleanup;
  let lastEl = null;
  let stopped = false;
  let replaceObserver;

  const run = (el) => {
    if (stopped || el === lastEl) return;
    if (typeof cleanup === "function") cleanup();
    lastEl = el;
    cleanup = setup(el) || undefined;
  };

  const initial = await waitForElement(selector, { timeout });
  run(initial);

  if (watchReplacement) {
    replaceObserver = new MutationObserver(() => {
      // The observer can fire on document teardown (jsdom test cleanup,
      // bfcache restore, etc.) after `document` has gone away. Bail out
      // rather than throwing.
      if (stopped || typeof document === "undefined" || !document) return;
      const el = document.querySelector(selector);
      if (el && el !== lastEl) run(el);
    });
    replaceObserver.observe(document.body, { childList: true, subtree: true });
  }

  return {
    stop: () => {
      stopped = true;
      replaceObserver?.disconnect();
      if (typeof cleanup === "function") cleanup();
    },
  };
}
