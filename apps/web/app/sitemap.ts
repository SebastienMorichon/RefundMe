import type { MetadataRoute } from "next";

const publicPaths = [
  "",
  "/cgu",
  "/cgv",
  "/confidentialite",
  "/contact",
  "/cookies",
  "/faq",
  "/mentions-legales",
  "/securite",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ).origin;
  return publicPaths.map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.5,
  }));
}
