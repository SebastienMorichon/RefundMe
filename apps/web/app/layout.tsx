import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Lydoc - Vos remboursements, sans la paperasse",
    template: "%s | Lydoc",
  },
  description:
    "Lydoc analyse vos factures, identifie les remboursements prévus par les règlements et prépare votre dossier.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
