import { pathToFileURL } from "node:url";

const SITE_ORIGIN = "https://lydoc.fr";
const BUFFER_ENDPOINT = "https://api.buffer.com";
const START_DATE = "2026-09-24";

function extractGuideUrls(sitemap) {
  return [...sitemap.matchAll(/<loc>\s*(https:\/\/lydoc\.fr\/guides\/[^<\s]+)\s*<\/loc>/g)]
    .map((match) => match[1].replace(/&amp;/g, "&"))
    .filter((url) => /^https:\/\/lydoc\.fr\/guides\/[a-z0-9-]+$/.test(url));
}

function extractArticle(html, url) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (data?.["@type"] !== "Article" || data.mainEntityOfPage !== url) continue;
    if (typeof data.headline !== "string" || typeof data.description !== "string") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.datePublished ?? "")) continue;
    return { url, title: data.headline.trim(), description: data.description.trim(), publishedAt: data.datePublished };
  }
  throw new Error(`Guide public non vérifiable : ${url}`);
}

function formatPost(article) {
  return `Nouveau guide Lydoc : ${article.title}\n\n${article.description}\n\nLes conditions dépendent du règlement applicable. L'organisateur décide du remboursement.\n\nLire le guide : ${article.url}`;
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!response.ok || new URL(response.url).origin !== SITE_ORIGIN) {
    throw new Error(`Page publique indisponible : ${url} (${response.status})`);
  }
  return response.text();
}

async function bufferRequest(apiKey, query, variables = {}) {
  const response = await fetch(BUFFER_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Buffer HTTP ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(`Buffer GraphQL : ${body.errors.map((error) => error.message).join("; ")}`);
  return body.data;
}

async function findLydocChannel(apiKey) {
  const account = await bufferRequest(apiKey, "query { account { organizations { id name } } }");
  const matches = [];
  for (const organization of account.account?.organizations ?? []) {
    const data = await bufferRequest(apiKey, "query($id: OrganizationId!) { channels(input: { organizationId: $id }) { id name service } }", { id: organization.id });
    for (const channel of data.channels ?? []) {
      if (channel.service?.toLowerCase() === "linkedin" && channel.name?.toLowerCase() === "lydoc") {
        matches.push({ organizationId: organization.id, channelId: channel.id });
      }
    }
  }
  if (matches.length !== 1) throw new Error(`Canal LinkedIn Lydoc introuvable ou ambigu (${matches.length})`);
  return matches[0];
}

async function existingUrls(apiKey, organizationId, channelId) {
  const urls = new Set();
  let after = null;
  do {
    const data = await bufferRequest(apiKey, `query($organizationId: OrganizationId!, $channelId: ChannelId!, $after: String) {
      posts(first: 100, after: $after, input: { organizationId: $organizationId, filter: { channelIds: [$channelId], createdAt: { start: "${START_DATE}T00:00:00Z" } } }) {
        edges { node { text } }
        pageInfo { hasNextPage endCursor }
      }
    }`, { organizationId, channelId, after });
    const posts = data.posts;
    for (const edge of posts?.edges ?? []) {
      for (const match of edge.node.text?.matchAll(/https:\/\/lydoc\.fr\/guides\/[a-z0-9-]+/g) ?? []) urls.add(match[0]);
    }
    if (!posts?.pageInfo?.hasNextPage) break;
    after = posts.pageInfo.endCursor;
    if (!after) throw new Error("Pagination Buffer incomplète");
  } while (true);
  return urls;
}

async function queuePost(apiKey, channelId, text) {
  const data = await bufferRequest(apiKey, `mutation($text: String!, $channelId: ChannelId!) {
    createPost(input: { text: $text, channelId: $channelId, schedulingType: automatic, mode: addToQueue }) {
      ... on PostActionSuccess { post { id dueAt } }
      ... on MutationError { message }
    }
  }`, { text, channelId });
  if (!data.createPost?.post?.id) throw new Error(`Buffer a refusé le post : ${data.createPost?.message ?? "réponse inconnue"}`);
  return data.createPost.post;
}

async function main() {
  const apiKey = process.env.BUFFER_API_KEY;
  if (!apiKey) throw new Error("BUFFER_API_KEY est absent");
  const dryRun = process.env.BUFFER_DRY_RUN === "true";
  const sitemap = await fetchText(`${SITE_ORIGIN}/sitemap.xml`);
  const urls = extractGuideUrls(sitemap);
  if (!urls.length) throw new Error("Aucun guide trouvé dans le sitemap public");
  const candidates = [];
  for (const url of urls) {
    const article = extractArticle(await fetchText(url), url);
    if (article.publishedAt >= START_DATE) candidates.push(article);
  }
  const { organizationId, channelId } = await findLydocChannel(apiKey);
  console.log("Canal LinkedIn Lydoc vérifié dans Buffer.");
  if (!candidates.length) {
    console.log("Aucun nouveau guide à publier.");
    return;
  }
  const seen = await existingUrls(apiKey, organizationId, channelId);
  for (const article of candidates.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))) {
    if (seen.has(article.url)) continue;
    if (dryRun) {
      console.log(`Simulation : guide à placer dans Buffer : ${article.url}`);
      continue;
    }
    const post = await queuePost(apiKey, channelId, formatPost(article));
    seen.add(article.url);
    console.log(`Guide placé dans la file Buffer : ${article.url} (${post.id})`);
  }
}

export { extractGuideUrls, extractArticle, formatPost };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
