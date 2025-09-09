export const queryParamsPlugin = (keys = ['utm_source','utm_medium','utm_campaign']) => ({
  init(ctx) {
    const qs = new URLSearchParams(location.search);
    const attrs = {};
    keys.forEach(k => { const v = qs.get(k); if (v) attrs[k] = v; });

    const prev = ctx.onSubmit;
    ctx.onSubmit = (values) => {
      const base = prev ? prev(values) : values;
      const payload = base || values || {};
      // return Object.keys(attrs).length ? { ...payload, attribution: attrs } : payload;
      return Object.keys(attrs).length ? {payload, ...payload } : payload;
    };
  }
});
