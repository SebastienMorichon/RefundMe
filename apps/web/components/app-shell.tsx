"use client";

import {
  Bell,
  ChevronDown,
  CircleHelp,
  FileText,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Brand } from "./brand";

export type AppSection =
  "dashboard" | "documents" | "cases" | "profile" | "admin" | "admin-invoices";

type AppShellProps = {
  children: ReactNode;
  active?: AppSection;
  email?: string | undefined;
  isAdmin?: boolean;
};

const navigation = [
  {
    id: "dashboard" as const,
    href: "/dashboard",
    label: "Accueil",
    icon: Home,
  },
  {
    id: "cases" as const,
    href: "/cases",
    label: "Dossiers",
    icon: FolderKanban,
  },
  {
    id: "documents" as const,
    href: "/documents",
    label: "Documents",
    icon: FileText,
  },
];

export function AppShell({
  children,
  active = "dashboard",
  email,
  isAdmin = false,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const initials = accountInitials(email);

  return (
    <div className="min-h-screen bg-[#fbfcfe] text-[#101a34]">
      <header className="sticky top-0 z-40 border-b border-[#e1e6ee] bg-white/95 backdrop-blur">
        <div className="page-container flex h-[72px] items-center gap-5">
          <a href="/dashboard" aria-label="Accueil Lydoc" className="shrink-0">
            <Brand />
          </a>

          <nav
            className="ml-7 hidden h-full items-center gap-9 md:flex"
            aria-label="Navigation principale"
          >
            {navigation.map((item) => (
              <a
                key={item.id}
                href={item.href}
                aria-current={active === item.id ? "page" : undefined}
                className={`relative flex h-full items-center text-sm font-bold transition-colors ${
                  active === item.id
                    ? "text-[#2457f5]"
                    : "text-[#34415d] hover:text-[#2457f5]"
                }`}
              >
                {item.label}
                {active === item.id ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#2457f5]" />
                ) : null}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
            <a
              href="/documents?new=1"
              aria-label="Ajouter une facture"
              title="Ajouter une facture"
              className="grid h-10 w-10 place-items-center rounded-full border border-[#d8e0eb] text-[#2457f5] transition-colors hover:border-[#2457f5] hover:bg-[#f4f7ff]"
            >
              <Plus size={20} />
            </a>
            <button
              type="button"
              aria-label="Notifications"
              title="Notifications"
              className="relative grid h-10 w-10 place-items-center rounded-full text-[#17213b] hover:bg-[#f1f4f8]"
            >
              <Bell size={19} />
              <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-[#e9654b]" />
            </button>

            <details className="group relative hidden sm:block">
              <summary
                className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-[#f3f6fa] [&::-webkit-details-marker]:hidden"
                aria-label="Ouvrir le menu du compte"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#edf1f7] text-xs font-extrabold text-[#17213b]">
                  {initials}
                </span>
                <ChevronDown
                  size={14}
                  className="text-[#6e7a91] transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="absolute right-0 top-[48px] w-64 overflow-hidden rounded-md border border-[#dce3ed] bg-white py-2 shadow-[0_18px_50px_rgba(16,37,68,0.14)]">
                <div className="border-b border-[#e7ebf1] px-4 pb-3 pt-1">
                  <p className="text-[11px] font-bold uppercase text-[#7a8499]">
                    Compte
                  </p>
                  <p className="mt-1 truncate text-sm font-bold text-[#17213b]">
                    {email ?? "Mon compte"}
                  </p>
                </div>
                <AccountLinks active={active} isAdmin={isAdmin} />
              </div>
            </details>

            <button
              type="button"
              onClick={() => setMobileOpen((current) => !current)}
              className="grid h-10 w-10 place-items-center rounded-md text-[#17213b] hover:bg-[#f1f4f8] md:hidden"
              aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-[#e5eaf1] bg-white px-4 py-4 md:hidden">
            <nav
              className="page-container grid gap-1"
              aria-label="Navigation mobile"
            >
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-bold ${
                      active === item.id
                        ? "bg-[#eef3ff] text-[#2457f5]"
                        : "text-[#34415d] hover:bg-[#f4f6f9]"
                    }`}
                  >
                    <Icon size={18} /> {item.label}
                  </a>
                );
              })}
              <div className="my-2 h-px bg-[#e5eaf1]" />
              <AccountLinks
                active={active}
                isAdmin={isAdmin}
                onNavigate={() => setMobileOpen(false)}
              />
            </nav>
          </div>
        ) : null}
      </header>

      <main className="min-h-[calc(100vh-72px)]">{children}</main>
    </div>
  );
}

function AccountLinks({
  active,
  isAdmin,
  onNavigate,
}: {
  active: AppSection;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const linkClass =
    "flex min-h-10 items-center gap-3 px-4 text-sm font-semibold text-[#3f4b65] hover:bg-[#f4f6f9] hover:text-[#2457f5]";

  return (
    <div className="py-1">
      <a
        href="/profile"
        onClick={onNavigate}
        className={`${linkClass} ${active === "profile" ? "text-[#2457f5]" : ""}`}
      >
        <Settings size={17} /> Mes informations
      </a>
      <a href="/faq" onClick={onNavigate} className={linkClass}>
        <CircleHelp size={17} /> Aide
      </a>
      {isAdmin ? (
        <>
          <div className="my-1 h-px bg-[#e7ebf1]" />
          <a
            href="/admin/rules"
            onClick={onNavigate}
            className={`${linkClass} ${active === "admin" ? "text-[#2457f5]" : ""}`}
          >
            <ShieldCheck size={17} /> Règlements
          </a>
          <a
            href="/admin/invoices"
            onClick={onNavigate}
            className={`${linkClass} ${active === "admin-invoices" ? "text-[#2457f5]" : ""}`}
          >
            <FileText size={17} /> Factures clients
          </a>
        </>
      ) : null}
      <div className="my-1 h-px bg-[#e7ebf1]" />
      <a href="/connexion" onClick={onNavigate} className={linkClass}>
        <LogOut size={17} /> Changer de compte
      </a>
    </div>
  );
}

function accountInitials(email?: string): string {
  const localPart = email?.split("@")[0]?.replace(/[^a-z0-9]/gi, "") ?? "LY";
  return (localPart.slice(0, 2) || "LY").toUpperCase();
}
