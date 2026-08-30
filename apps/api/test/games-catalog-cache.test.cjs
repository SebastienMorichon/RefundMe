const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GamesController,
  matchesEntityTag,
} = require("../dist/modules/rules/games.controller.js");

function request(ifNoneMatch) {
  return {
    header(name) {
      return name.toLowerCase() === "if-none-match" ? ifNoneMatch : undefined;
    },
  };
}

function response() {
  return {
    headers: new Map([["pragma", "no-cache"]]),
    statusCode: 200,
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), value);
    },
    removeHeader(name) {
      this.headers.delete(name.toLowerCase());
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

test("public catalog responses have a short shared cache policy and stable ETag", async () => {
  let catalogCalls = 0;
  const channels = [
    {
      id: "m6",
      name: "M6",
      games: [{ id: "rule-1", name: "Jeu A" }],
    },
  ];
  const controller = new GamesController({
    catalog: async () => {
      catalogCalls += 1;
      return channels;
    },
  });

  const initialResponse = response();
  const payload = await controller.catalog(request(), initialResponse);
  const etag = initialResponse.headers.get("etag");

  assert.deepEqual(payload, { channels });
  assert.equal(catalogCalls, 1);
  assert.match(etag, /^"[A-Za-z0-9_-]{43}"$/);
  assert.equal(
    initialResponse.headers.get("cache-control"),
    "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
  );
  assert.equal(initialResponse.headers.get("vary"), "Origin");
  assert.equal(initialResponse.headers.has("pragma"), false);

  const cachedResponse = response();
  assert.deepEqual(
    await controller.catalog(request('"different"'), cachedResponse),
    { channels },
  );
  assert.equal(catalogCalls, 1);
  assert.equal(cachedResponse.headers.get("etag"), etag);
});

test("If-None-Match uses weak comparison and returns 304 without a body", async () => {
  const controller = new GamesController({ catalog: async () => [] });
  const initialResponse = response();
  await controller.catalog(request(), initialResponse);
  const etag = initialResponse.headers.get("etag");
  const conditionalResponse = response();

  const result = await controller.catalog(
    request(`"older", W/${etag}`),
    conditionalResponse,
  );

  assert.equal(result, undefined);
  assert.equal(conditionalResponse.statusCode, 304);
  assert.equal(conditionalResponse.headers.get("etag"), etag);
  assert.equal(matchesEntityTag("*", etag), true);
  assert.equal(matchesEntityTag('"different"', etag), false);
});

test("the server-side catalog cache refreshes after its short TTL", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  let catalogCalls = 0;
  Date.now = () => now;
  const controller = new GamesController({
    catalog: async () => [{ id: `channel-${++catalogCalls}`, games: [] }],
  });

  try {
    const firstResponse = response();
    const first = await controller.catalog(request(), firstResponse);
    now += 60_001;
    const secondResponse = response();
    const second = await controller.catalog(request(), secondResponse);

    assert.equal(catalogCalls, 2);
    assert.notDeepEqual(second, first);
    assert.notEqual(
      secondResponse.headers.get("etag"),
      firstResponse.headers.get("etag"),
    );
  } finally {
    Date.now = originalNow;
  }
});
