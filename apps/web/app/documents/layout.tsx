import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { documentsPageEnabled } from "../../lib/feature-flags";

export default function DocumentsLayout({ children }: { children: ReactNode }) {
  if (!documentsPageEnabled) redirect("/dashboard");

  return children;
}
