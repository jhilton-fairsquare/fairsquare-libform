import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transport, TransportError } from "../lib/form-core/adapters/transport.js";

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: ["OK", "Bad Request", "Server Error"][Math.floor(status / 200) - 1] || "",
  headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const textResponse = (status, text) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: "",
  headers: { get: () => "text/plain" },
  json: async () => { throw new Error("not json"); },
  text: async () => text,
});

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ctx = { id: "test-form" };

describe("transport: success", () => {
  it("200 returns parsed JSON body", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse(200, { success: true, url: "https://nf.example/apply?x=1" })
    );
    const t = transport("https://api.example/submit");
    const res = await t.send({ a: 1 }, ctx);
    expect(res).toEqual({ success: true, url: "https://nf.example/apply?x=1" });
  });

  it("sends Content-Type: application/json and POST", async () => {
    globalThis.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const t = transport("https://api.example/submit");
    await t.send({ x: 1 }, ctx);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://api.example/submit");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ x: 1 }));
  });

  it("defaults credentials to 'omit'", async () => {
    globalThis.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const t = transport("https://api.example/submit");
    await t.send({}, ctx);
    expect(globalThis.fetch.mock.calls[0][1].credentials).toBe("omit");
  });

  it("merges custom headers", async () => {
    globalThis.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const t = transport("https://api.example/submit", { headers: { "X-Source": "test" } });
    await t.send({}, ctx);
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.headers["X-Source"]).toBe("test");
    expect(init.headers["Content-Type"]).toBe("application/json"); // not clobbered
  });

  it("attaches Idempotency-Key when getter provided", async () => {
    globalThis.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const t = transport("https://api.example/submit", {
      idempotencyKey: () => "NFID-abc123",
    });
    await t.send({}, ctx);
    expect(globalThis.fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("NFID-abc123");
  });

  it("transformPayload reshapes the body", async () => {
    globalThis.fetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const t = transport("https://api.example/submit", {
      transformPayload: (p) => ({ wrapped: p }),
    });
    await t.send({ a: 1 }, ctx);
    expect(globalThis.fetch.mock.calls[0][1].body).toBe(JSON.stringify({ wrapped: { a: 1 } }));
  });
});

describe("transport: error responses", () => {
  it("throws TransportError with status 400 and body.fields[]", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse(400, { success: false, message: "Validation failed", fields: ["email", "phone"] })
    );
    const t = transport("https://api.example/submit");
    await expect(t.send({}, ctx)).rejects.toMatchObject({
      name: "TransportError",
      status: 400,
      body: { success: false, message: "Validation failed", fields: ["email", "phone"] },
      url: null,
      message: "Validation failed",
    });
  });

  it("400 missingFields with fallback url surfaces both in error", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse(400, {
        success: false, message: "Incomplete data for workflow execution",
        missingFields: ["consent"], url: "https://nf.example/fallback",
      })
    );
    const t = transport("https://api.example/submit");
    let caught;
    try { await t.send({}, ctx); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(TransportError);
    expect(caught.status).toBe(400);
    expect(caught.url).toBe("https://nf.example/fallback");
    expect(caught.body.missingFields).toEqual(["consent"]);
  });

  it("500 with url is surfaced for fallback redirect", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse(500, { success: false, message: "Execution failed", url: "https://nf.example/fallback" })
    );
    const t = transport("https://api.example/submit");
    await expect(t.send({}, ctx)).rejects.toMatchObject({
      status: 500,
      url: "https://nf.example/fallback",
    });
  });

  it("non-JSON error body is captured as text", async () => {
    globalThis.fetch.mockResolvedValueOnce(textResponse(502, "Bad Gateway"));
    const t = transport("https://api.example/submit");
    await expect(t.send({}, ctx)).rejects.toMatchObject({
      status: 502,
      body: "Bad Gateway",
    });
  });
});

describe("transport: network and timeout", () => {
  it("network failure becomes TransportError(status: 0)", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const t = transport("https://api.example/submit");
    await expect(t.send({}, ctx)).rejects.toMatchObject({
      name: "TransportError",
      status: 0,
      body: null,
      url: null,
    });
  });

  it("times out via AbortController", async () => {
    // fetch hangs — AbortController should reject with abort
    globalThis.fetch.mockImplementationOnce(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    const t = transport("https://api.example/submit", { timeoutMs: 10 });
    await expect(t.send({}, ctx)).rejects.toMatchObject({ name: "TransportError", status: 0 });
  });
});
