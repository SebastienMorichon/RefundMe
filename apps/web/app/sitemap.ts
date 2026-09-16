import type { MetadataRoute } from "next";
import { guides } from "../lib/guides";

const publicPaths = [
  "",
  "/cgu",
  "/cgv",
  "/confidentialite",
  "/contact",
  "/cookies",
  "/faq",
  "/guides",
  "/mentions-legales",
  "/methode",
  "/securite",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://lydoc.fr")
    .origin;
  return [
    ...publicPaths.map((path) => ({
      url: `${origin}${path}`,
      changeFrequency:
        path === "" || path === "/guides" || path.startsWith("/guides/")
          ? ("weekly" as const)
          : ("monthly" as const),
      priority: path === "" ? 1 : path.startsWith("/guides") ? 0.8 : 0.5,
    })),
    ...guides.map((guide) => ({
      url: `${origin}/guides/${guide.slug}`,
      lastModified: guide.modifiedAt ?? "2026-09-13",
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
