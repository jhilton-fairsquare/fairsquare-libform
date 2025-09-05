// form-core/FormController.js
export class FormController {
  constructor({ id, fields, onSubmit, onSuccess, onError, transport, plugins = [], dom }) {
    this.id = id;
    this.fields = fields; // { name: { get, set?, validate } }
    this.onSubmit = onSubmit;
    this.onSuccess = onSuccess || (() => {});
    this.onError = onError || (() => {});
    this.transport = transport;
    this.plugins = plugins;
    this.dom = dom; // { query, on, off, setError, clearError, setDisabled }
    this.state = { submitting: false, errors: {} };
    this._wire();
    this.plugins.forEach(p => p.init?.(this));
  }

  _wire() {
    const formEl = this.dom.query(`[data-form="${this.id}"]`);
    this.dom.on(formEl, "submit", async (e) => {
      e.preventDefault();
      await this.submit();
    });

    // Per-field blur => validate field only
    Object.keys(this.fields).forEach((name) => {
      const input = this.dom.query(`[data-form="${this.id}"] [name="${name}"]`);
      if (!input) return;
      this.dom.on(input, "blur", async () => {
        const { valid, message } = await this.fields[name].validate(this._getValue(name), this.getValues());
        console.log(message);
        if (!valid) this._setFieldError(name, message);
        else this._clearFieldError(name);
      });
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
    this.dom.setDisabled(`[data-form="${this.id}"] [type="submit"]`, true);
    const payload = this.onSubmit ? this.onSubmit(this.getValues()) : this.getValues();

    try {
      const res = await this.transport.send(payload, this);
      this.plugins.forEach((p) => p.onSuccess?.(res, this));
      await this.onSuccess(res, this);
    } catch (err) {
      this.plugins.forEach((p) => p.onError?.(err, this));
      await this.onError(err, this);
    } finally {
      this.state.submitting = false;
      this.dom.setDisabled(`[data-form="${this.id}"] [type="submit"]`, false);
    }
  }

  _setFieldError(name, message) {
    this.state.errors[name] = message;
    this.dom.setError(`[data-form="${this.id}"] [name="${name}"]`, message);
  }
  _clearFieldError(name) {
    delete this.state.errors[name];
    this.dom.clearError(`[data-form="${this.id}"] [name="${name}"]`);
  }
}
