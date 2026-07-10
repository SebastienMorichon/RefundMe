const assert = require("node:assert/strict");
const test = require("node:test");
const { readApiRuntimeConfig } = require("../dist/index.js");

test("uses local defaults for the API during development", () => {
  assert.deepEqual(readApiRuntimeConfig({ NODE_ENV: "development" }), {
    nodeEnv: "development",
    port: 3001,
    appOrigins: ["http://localhost:3000"],
    trustProxy: false,
  });
});

test("requires an explicit browser origin in production", () => {
  assert.throws(
    () => readApiRuntimeConfig({ NODE_ENV: "production" }),
    /Missing environment variable: APP_URL/,
  );
});

test("rejects an invalid port", () => {
  assert.throws(
    () => readApiRuntimeConfig({ NODE_ENV: "development", PORT: "70000" }),
    /PORT must be an integer/,
  );
});
