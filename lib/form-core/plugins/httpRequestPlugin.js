export const httpRequestPlugin = () => ({
  init(ctx) {
    const http_referrer = document.referrer;
    const full_url = window.location.href;
    const httpRequest = {};
    httpRequest['http_referrer'] = http_referrer;
    httpRequest['full_url'] = full_url;

    const prev = ctx.onSubmit;
    ctx.onSubmit = (values) => {
      const base = prev ? prev(values) : values;
      const payload = base || values || {};
      return { ...payload, httpRequest };
    };
  }
});
