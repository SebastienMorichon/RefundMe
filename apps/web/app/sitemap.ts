import type { MetadataRoute } from "next";

const publicPaths = [
  "",
  "/cgu",
  "/cgv",
  "/confidentialite",
  "/contact",
  "/cookies",
  "/faq",
  "/guides",
  "/guides/remboursement-sms-surtaxe-jeu-concours",
  "/guides/justificatifs-remboursement-sms",
  "/guides/trouver-sms-surtaxes-facture-mobile",
  "/guides/delai-demande-remboursement-jeu-concours",
  "/guides/lettre-remboursement-sms-jeu-concours",
  "/mentions-legales",
  "/methode",
  "/securite",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ).origin;
  return publicPaths.map((path) => ({
    url: `${origin}${path}`,
    changeFrequency:
      path === "" || path === "/guides" || path.startsWith("/guides/")
        ? "weekly"
        : "monthly",
    priority: path === "" ? 1 : path.startsWith("/guides") ? 0.8 : 0.5,
  }));
}
