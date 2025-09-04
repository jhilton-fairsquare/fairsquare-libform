// FormFactory.js
import { FormController } from "./form-core/FormController.js";
import { dom } from "./form-core/adapters/dom.js";
import { transport as mkTransport } from "./form-core/adapters/transport.js";

export function createForm(config) {
  const {
    id,
    fields,            // { name: { get, set?, validate } }
    endpoint,          // submit URL
    plugins = [],
    onSubmit, onSuccess, onError,
    transport = mkTransport(endpoint),
    domAdapter = dom,
  } = config;

  return new FormController({
    id, fields, plugins,
    onSubmit, onSuccess, onError,
    transport, dom: domAdapter,
  });
}
