// form-core/adapters/transport.js
export const transport = (endpoint, headers = {}) => ({
  async send(payload, ctx) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ formId: ctx.id, ...payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Submit failed (${res.status}): ${text}`);
    }
    return res.json().catch(() => ({}));
  },
});
