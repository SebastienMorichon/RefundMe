import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AnalyticsConsent } from "../components/analytics-consent";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Lydoc - Vos remboursements, sans la paperasse",
    template: "%s | Lydoc",
  },
  description:
    "Lydoc vous aide à préparer gratuitement votre dossier de remboursement de SMS surtaxés et peut prendre en charge son envoi postal.",
  applicationName: "Lydoc",
  authors: [{ name: "Lydoc" }],
  creator: "Lydoc",
  publisher: "Lydoc",
  category: "services administratifs",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Lydoc",
    title: "Lydoc - Vos remboursements, sans la paperasse",
    description:
      "Préparez gratuitement votre dossier de remboursement de SMS surtaxés liés aux jeux-concours.",
    images: [
      {
        url: "/images/lydoc-hero-invoice.png",
        width: 1200,
        height: 630,
        alt: "Lydoc prépare votre dossier de remboursement de SMS surtaxés",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lydoc - Vos remboursements, sans la paperasse",
    description:
      "Préparez gratuitement votre dossier de remboursement de SMS surtaxés liés aux jeux-concours.",
    images: ["/images/lydoc-hero-invoice.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
  icons: {
    icon: "/brand/lydoc-mark.svg",
    shortcut: "/brand/lydoc-mark.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" data-scroll-behavior="smooth">
      <body className="antialiased">
        {children}
        <AnalyticsConsent />
      </body>
    </html>
  );
}
