import assert from "node:assert/strict";
import { test } from "node:test";
import { extractArticle, extractGuideUrls, formatPost } from "./publish-new-guides-to-buffer.mjs";

test("extracts only Lydoc guide URLs from sitemap", () => {
  const xml = `<urlset><url><loc>https://lydoc.fr/guides/guide-a</loc></url><url><loc>https://lydoc.fr/guides</loc></url><url><loc>https://example.org/guides/guide-b</loc></url></urlset>`;
  assert.deepEqual(extractGuideUrls(xml), ["https://lydoc.fr/guides/guide-a"]);
});

test("requires verified public article metadata", () => {
  const url = "https://lydoc.fr/guides/guide-a";
  const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Article", headline: "Titre", description: "Résumé", datePublished: "2026-09-24", mainEntityOfPage: url })}</script>`;
  const article = extractArticle(html, url);
  assert.equal(article.title, "Titre");
  assert.match(formatPost(article), /https:\/\/lydoc\.fr\/guides\/guide-a/);
  assert.throws(() => extractArticle(html, "https://lydoc.fr/guides/autre"));
});
