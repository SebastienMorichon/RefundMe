import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Règlements des jeux",
  description:
    "Consultez les dates, conditions, justificatifs et modalités de remboursement des jeux référencés par Lydoc.",
};

export default function RulesLayout({ children }: { children: ReactNode }) {
  return children;
}
