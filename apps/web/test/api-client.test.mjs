import assert from "node:assert/strict";
import test from "node:test";
import {
  apiFetch,
  clearApiCsrfToken,
} from "../lib/api-client.ts";

const tokenA = `${"a".repeat(43)}.${"b".repeat(43)}`;
const tokenB = `${"c".repeat(43)}.${"d".repeat(43)}`;

test.afterEach(() => {
  clearApiCsrfToken();
});

test("safe requests do not perform a CSRF handshake", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    assert.equal(init.credentials, "include");
    return Response.json({ ok: true });
  };

  const response = await apiFetch("https://api.example.test/items");
  assert.equal(response.ok, true);
  assert.equal(calls, 1);
});

test("mutations fetch, cache and send the signed CSRF token", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    if (String(input).endsWith("/auth/csrf")) {
      return Response.json({ csrfToken: tokenA });
    }
    assert.equal(new Headers(init.headers).get("x-csrf-token"), tokenA);
    assert.equal(init.credentials, "include");
    return Response.json({ ok: true });
  };

  await apiFetch("https://api.example.test/items", { method: "POST" });
  await apiFetch("https://api.example.test/items/1", { method: "DELETE" });
  assert.equal(calls.filter(({ input }) => input.endsWith("/auth/csrf")).length, 1);
});

test("a rejected mutation refreshes the token once", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let handshakes = 0;
  let mutations = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/auth/csrf")) {
      handshakes += 1;
      return Response.json({ csrfToken: handshakes === 1 ? tokenA : tokenB });
    }
    mutations += 1;
    const expected = mutations === 1 ? tokenA : tokenB;
    assert.equal(new Headers(init.headers).get("x-csrf-token"), expected);
    return mutations === 1
      ? Response.json(
          { code: "CSRF_INVALID", message: "Verification CSRF impossible." },
          { status: 403 },
        )
      : Response.json({ ok: true });
  };

  const response = await apiFetch("https://api.example.test/items", {
    method: "PATCH",
  });
  assert.equal(response.ok, true);
  assert.equal(handshakes, 2);
  assert.equal(mutations, 2);
});

test("a business 403 is returned without replaying the mutation", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let handshakes = 0;
  let mutations = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/auth/csrf")) {
      handshakes += 1;
      return Response.json({ csrfToken: tokenA });
    }
    mutations += 1;
    return Response.json(
      { code: "ACCOUNT_FORBIDDEN", message: "Operation interdite." },
      { status: 403 },
    );
  };

  const response = await apiFetch("https://api.example.test/items", {
    method: "DELETE",
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "ACCOUNT_FORBIDDEN");
  assert.equal(handshakes, 1);
  assert.equal(mutations, 1);
});
