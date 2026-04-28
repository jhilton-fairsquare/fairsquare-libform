// FormFactory.js
import { FormController } from "./form-core/FormController.js";
import { dom } from "./form-core/adapters/dom.js";
import { transport as mkTransport } from "./form-core/adapters/transport.js";
import { mount } from "./form-core/mount.js";

/**
 * createForm
 * Synchronous: returns a controller-like handle immediately. Wiring is deferred
 * until the form node exists in the DOM, so this is safe to call before
 * Framer/Webflow/SPA hydration completes.
 *
 * @returns {{ ready: Promise<FormController>, controller: () => FormController | null, stop: () => void }}
 */
export function createForm(config) {
  const {
    id,
    fields,
    endpoint,
    plugins = [],
    onSubmit,
    onSuccess,
    onError,
    transport = mkTransport(endpoint),
    domAdapter = dom,
    mountTimeout = 10000,
    watchReplacement = false,
    debug = false,
  } = config;

  if (!id) throw new Error("createForm: `id` is required");
  if (!fields) throw new Error("createForm: `fields` is required");

  let controller = null;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const handle = {
    ready,
    controller: () => controller,
    stop: () => mounted?.then((m) => m.stop()).catch(() => {}),
  };

  const mounted = mount(
    `[data-form="${id}"]`,
    () => {
      controller = new FormController({
        id,
        fields,
        plugins,
        onSubmit,
        onSuccess,
        onError,
        transport,
        dom: domAdapter,
        debug,
      });
      resolveReady(controller);
      return () => {
        // teardown placeholder; FormController doesn't currently track listeners
        controller = null;
      };
    },
    { timeout: mountTimeout, watchReplacement }
  ).catch((err) => {
    rejectReady(err);
    if (onError) onError(err, null);
  });

  return handle;
}
