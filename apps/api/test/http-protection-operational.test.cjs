const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createGeneralRateLimiter,
  createRateLimiter,
  parseTrustedProxyCidrs,
  rateLimitBucketPath,
  readGeneralRateLimitPerMinute,
} = require("../dist/platform/http-protection.js");

function createResponse() {
  return {
    headers: new Map(),
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), value);
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest({ path, method = "POST", ip = "203.0.113.10" }) {
  return {
    path,
    method,
    ip,
    socket: { remoteAddress: ip },
  };
}

test("document identifiers share bounded rate-limit buckets", () => {
  assert.equal(rateLimitBucketPath("/documents/document-a"), "/documents/:id");
  assert.equal(rateLimitBucketPath("/documents/document-b"), "/documents/:id");
  assert.equal(
    rateLimitBucketPath("/documents/document-a/case"),
    "/documents/:id/case",
  );
  assert.equal(
    rateLimitBucketPath("/documents/document-b/case"),
    "/documents/:id/case",
  );

  const limiter = createRateLimiter(1, 60_000, () => 1_000);
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  limiter(
    createRequest({ path: "/documents/document-a/case" }),
    createResponse(),
    next,
  );
  const caseResponse = createResponse();
  limiter(
    createRequest({ path: "/DOCUMENTS/document-b/CASE/" }),
    caseResponse,
    next,
  );

  limiter(
    createRequest({ path: "/documents/document-a", method: "DELETE" }),
    createResponse(),
    next,
  );
  const documentResponse = createResponse();
  limiter(
    createRequest({ path: "/documents/document-b", method: "DELETE" }),
    documentResponse,
    next,
  );

  assert.equal(nextCalls, 2);
  assert.equal(caseResponse.statusCode, 429);
  assert.equal(documentResponse.statusCode, 429);
});

test("general API rate limiting follows the client across route changes", () => {
  const limiter = createGeneralRateLimiter(2, 60_000, () => 1_000);
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  limiter(
    createRequest({ path: "/games/catalog", method: "GET" }),
    createResponse(),
    next,
  );
  limiter(
    createRequest({ path: "/pricing", method: "GET" }),
    createResponse(),
    next,
  );
  const blockedResponse = createResponse();
  limiter(
    createRequest({ path: "/cases", method: "GET" }),
    blockedResponse,
    next,
  );

  limiter(
    createRequest({ path: "/health/live", method: "GET" }),
    createResponse(),
    next,
  );
  limiter(
    createRequest({ path: "/health/ready", method: "GET" }),
    createResponse(),
    next,
  );

  assert.equal(nextCalls, 4);
  assert.equal(blockedResponse.statusCode, 429);
  assert.equal(blockedResponse.headers.get("retry-after"), 60);
});

test("production requires an explicit bounded general API rate limit", () => {
  assert.equal(readGeneralRateLimitPerMinute({ NODE_ENV: "test" }), 120);
  assert.equal(
    readGeneralRateLimitPerMinute({
      NODE_ENV: "production",
      API_GENERAL_RATE_LIMIT_PER_MINUTE: "240",
    }),
    240,
  );
  assert.throws(() =>
    readGeneralRateLimitPerMinute({ NODE_ENV: "production" }),
  );
  assert.throws(() =>
    readGeneralRateLimitPerMinute({
      NODE_ENV: "production",
      API_GENERAL_RATE_LIMIT_PER_MINUTE: "10001",
    }),
  );
});

test("the in-memory limiter stays bounded under many distinct clients", () => {
  const limiter = createGeneralRateLimiter(1, 60_000, () => 1_000);
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  limiter(
    createRequest({ path: "/games/catalog", ip: "client-oldest" }),
    createResponse(),
    next,
  );
  for (let index = 0; index < 9_999; index += 1) {
    limiter(
      createRequest({ path: "/games/catalog", ip: `client-${index}` }),
      createResponse(),
      next,
    );
  }
  limiter(
    createRequest({ path: "/games/catalog", ip: "client-newest" }),
    createResponse(),
    next,
  );
  limiter(
    createRequest({ path: "/games/catalog", ip: "client-oldest" }),
    createResponse(),
    next,
  );
  const recentClientResponse = createResponse();
  limiter(
    createRequest({ path: "/games/catalog", ip: "client-newest" }),
    recentClientResponse,
    next,
  );

  assert.equal(nextCalls, 10_002);
  assert.equal(recentClientResponse.statusCode, 429);
});

test("production trusts only explicit proxy host addresses", () => {
  assert.throws(() => parseTrustedProxyCidrs(false, undefined, true));
  assert.deepEqual(
    parseTrustedProxyCidrs(true, "172.28.0.1/32, fd00:1234::1/128", true),
    ["172.28.0.1/32", "fd00:1234::1/128"],
  );
  assert.throws(() => parseTrustedProxyCidrs(true, "172.28.0.0/24", true));
  assert.throws(() => parseTrustedProxyCidrs(true, "10.0.0.0/8", true));
  assert.throws(() => parseTrustedProxyCidrs(true, "0.0.0.0/32", true));
  assert.throws(() => parseTrustedProxyCidrs(true, "224.0.0.1/32", true));
});
