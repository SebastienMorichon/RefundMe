import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const origin = readApplicationOrigin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/cgu", "/cgv", "/confidentialite", "/securite"],
        disallow: [
          "/admin/",
          "/cases/",
          "/dashboard",
          "/documents",
          "/profile",
          "/notifications",
          "/achievements",
          "/reglements",
          "/connexion",
          "/inscription",
          "/verification-email",
          "/mot-de-passe-oublie",
          "/reinitialisation-mot-de-passe",
          "/codex-alignment-check",
          "/codex-visual-check",
          "/codex-visual-check-mobile",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}

function readApplicationOrigin(): string {
  return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
    .origin;
}
