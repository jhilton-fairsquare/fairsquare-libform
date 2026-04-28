// form-core/FormController.js
export class FormController {
  constructor({ id, fields, onSubmit, onSuccess, onError, transport, plugins = [], dom, debug = false }) {
    this.id = id;
    this.fields = fields; // { name: { get, set?, validate, format? } }
    this.onSubmit = onSubmit;
    this.onSuccess = onSuccess || (() => {});
    this.onError = onError || (() => {});
    this.transport = transport;
    this.plugins = plugins;
    this.dom = dom; // { query, on, off, setError, clearError, setDisabled }
    this.debug = debug;
    this.state = { submitting: false, errors: {} };
    this.formSelector = `[data-form="${this.id}"]`;
    this._wire();
    this.plugins.forEach(p => p.init?.(this));
  }

  _log(...args) {
    if (this.debug && typeof console !== "undefined") console.log("[libform]", ...args);
  }

  _fieldSelector(name) {
    return `${this.formSelector} [name="${name}"]`;
  }

  _wire() {
    const formEl = this.dom.query(this.formSelector);
    if (!formEl) {
      this._log(`form not found for selector ${this.formSelector}`);
      return;
    }
    this.formEl = formEl;
    this.dom.on(formEl, "submit", async (e) => {
      e.preventDefault();
      await this.submit();
    });

    // Per-field validation (blur) and live formatting (input)
    Object.keys(this.fields).forEach((name) => {
      const input = this.dom.query(this._fieldSelector(name));
      if (!input) return;
      const field = this.fields[name];

      this.dom.on(input, "blur", async () => {
        const { valid, message } = await field.validate(this._getValue(name), this.getValues());
        if (!valid) this._setFieldError(name, message);
        else this._clearFieldError(name);
      });

      if (typeof field.format === "function") {
        this.dom.on(input, "input", () => {
          const next = field.format(input.value);
          if (next !== input.value) input.value = next;
        });
      }
    });
  }

  _getValue(name) {
    const field = this.fields[name];
    try {
      const v = field.get?.();
      return v;
    } catch (e) {
      return "";
    }
  }

  getValues() {
    const values = {};
    for (const name of Object.keys(this.fields)) {
      values[name] = this._getValue(name);
    }
    return values;
  }

  async validateAll() {
    const values = this.getValues();
    const results = await Promise.all(
      Object.entries(this.fields).map(async ([name, f]) => {
        const { valid, message } = await f.validate(values[name], values);
        return [name, { valid, message }];
      })
    );
    const errors = Object.fromEntries(results.filter(([, r]) => !r.valid).map(([n, r]) => [n, r.message]));
    this.state.errors = errors;

    // reflect in UI
    for (const [name, msg] of Object.entries(errors)) this._setFieldError(name, msg);
    for (const name of Object.keys(this.fields)) if (!errors[name]) this._clearFieldError(name);

    return { valid: Object.keys(errors).length === 0, errors };
  }

  async submit() {
    if (this.state.submitting) return;
    const { valid, errors } = await this.validateAll();
    if (!valid) {
      this.plugins.forEach((p) => p.onValidationFail?.(errors, this));
      return;
    }
    this.state.submitting = true;
    const submitSelector = `${this.formSelector} [type="submit"]`;
    this.dom.setDisabled(submitSelector, true);

    let payload = this.onSubmit ? this.onSubmit(this.getValues()) : this.getValues();
    if (payload && typeof payload.then === "function") payload = await payload;

    for (const p of this.plugins) {
      if (typeof p.onBeforeSend !== "function") continue;
      try { await p.onBeforeSend(payload, this); } catch (e) { this._log("onBeforeSend error", e); }
    }

    try {
      const res = await this.transport.send(payload, this);
      for (const p of this.plugins) {
        if (typeof p.onAfterSend !== "function") continue;
        try { await p.onAfterSend({ ok: true, res }, this); } catch (e) { this._log("onAfterSend error", e); }
      }
      this.plugins.forEach((p) => p.onSuccess?.(res, this));
      await this.onSuccess(res, this);
    } catch (err) {
      for (const p of this.plugins) {
        if (typeof p.onAfterSend !== "function") continue;
        try { await p.onAfterSend({ ok: false, err }, this); } catch (e) { this._log("onAfterSend error", e); }
      }
      this.plugins.forEach((p) => p.onError?.(err, this));
      await this.onError(err, this);
    } finally {
      this.state.submitting = false;
      this.dom.setDisabled(submitSelector, false);
    }
  }

  _setFieldError(name, message) {
    this.state.errors[name] = message;
    this.dom.setError(this._fieldSelector(name), message);
  }
  _clearFieldError(name) {
    delete this.state.errors[name];
    this.dom.clearError(this._fieldSelector(name));
  }
}
