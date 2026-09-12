import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

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
  icons: {
    icon: "/brand/lydoc-mark.svg",
    shortcut: "/brand/lydoc-mark.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" data-scroll-behavior="smooth">
      <body className="antialiased">{children}</body>
    </html>
  );
}
