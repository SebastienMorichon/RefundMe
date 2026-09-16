import assert from "node:assert/strict";
import test from "node:test";
import { guides, findGuide } from "../lib/guides.ts";

test("guides have unique routes and valid related articles", () => {
  assert.equal(new Set(guides.map((guide) => guide.slug)).size, guides.length);
  for (const guide of guides) {
    assert.match(guide.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(guide.title && guide.description && guide.sections.length);
    for (const slug of guide.relatedSlugs ?? []) {
      assert.notEqual(slug, guide.slug);
      assert.ok(findGuide(slug), `Missing related guide: ${slug}`);
    }
  }
});

test("weekly articles have consistent dates and public HTTPS sources", () => {
  for (const guide of guides.filter((item) => item.publishedAt)) {
    for (const value of [guide.publishedAt, guide.modifiedAt]) {
      assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(value).toISOString().slice(0, 10), value);
    }
    assert.ok(guide.modifiedAt >= guide.publishedAt);
    assert.ok(guide.sources?.length >= 2);
    for (const source of guide.sources) {
      const url = new URL(source.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.username + url.password, "");
      assert.ok(source.title);
    }
  }
});
