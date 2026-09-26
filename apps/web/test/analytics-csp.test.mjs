import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.ts";

test("the site policy permits consented GA4 without advertising hosts", async () => {
  const rules = await nextConfig.headers();
  const siteHeaders = rules.find((rule) => rule.source === "/(.*)")?.headers;
  const policy = siteHeaders?.find((header) => header.key === "Content-Security-Policy")?.value;
  assert.ok(policy);

  const directives = new Map(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );

  assert.ok(directives.get("script-src")?.includes("https://www.googletagmanager.com"));
  assert.ok(directives.get("connect-src")?.includes("https://*.google-analytics.com"));
  assert.ok(directives.get("img-src")?.includes("https://*.google-analytics.com"));
  assert.ok(!policy.includes("doubleclick.net"));
});
