"use client";

import {
  Bell,
  CircleHelp,
  FileText,
  Home,
  LogOut,
  Menu,
  MessageCircleMore,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { apiFetch as fetch } from "../lib/api-client";
import { documentsPageEnabled } from "../lib/feature-flags";
import { Brand } from "./brand";
import { CaseFolderIcon, ProgressIcon, type LydocIcon } from "./lydoc-icons";

export type AppSection =
  | "dashboard"
  | "documents"
  | "cases"
  | "achievements"
  | "profile"
  | "notifications"
  | "admin-clients"
  | "admin"
  | "admin-invoices"
  | "admin-pricing";

type AppShellProps = {
  children: ReactNode;
  active?: AppSection;
  email?: string | undefined;
  isAdmin?: boolean;
};

type NavigationItem = {
  id: AppSection;
  href: string;
  label: string;
  icon: LucideIcon | LydocIcon;
};

const navigationItems: NavigationItem[] = [
  { id: "dashboard", href: "/dashboard", label: "Tableau de bord", icon: Home },
  {
    id: "documents",
    href: "/documents",
    label: "Mes factures",
    icon: FileText,
  },
  { id: "cases", href: "/cases", label: "Mes dossiers", icon: CaseFolderIcon },
  {
    id: "achievements",
    href: "/achievements",
    label: "Progression",
    icon: ProgressIcon,
  },
  { id: "notifications", href: "/notifications", label: "Alertes", icon: Bell },
  { id: "profile", href: "/profile", label: "Paramètres", icon: Settings },
];

const navigation = navigationItems.filter(
  (item) => documentsPageEnabled || item.id !== "documents",
);

export function AppShell({
  children,
  active = "dashboard",
  email,
  isAdmin = false,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLElement>(null);
  const initials = accountInitials(email);

  async function logout() {
    if (logoutPending) return;
    setLogoutPending(true);
    setLogoutError("");
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
      const response = await fetch(`${apiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("logout failed");
      window.location.assign("/connexion");
    } catch {
      setLogoutPending(false);
      setLogoutError(
        "La session n'a pas pu etre fermee. Reessayez avant de quitter cet appareil.",
      );
    }
  }

  useEffect(() => {
    if (!email) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    void fetch(`${apiUrl}/notifications`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!payload || typeof payload !== "object") return;
        const notifications = (payload as Record<string, unknown>)
          .notifications;
        setHasUnreadNotifications(
          Array.isArray(notifications) &&
            notifications.some(
              (item) =>
                Boolean(item) &&
                typeof item === "object" &&
                !(item as Record<string, unknown>).readAt,
            ),
        );
      })
      .catch(() => undefined);
  }, [email]);

  useEffect(() => {
    if (!email) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

    function recordVisibleActivity() {
      if (document.visibilityState !== "visible") return;
      void fetch(`${apiUrl}/auth/me`, {
        credentials: "include",
        cache: "no-store",
      }).catch(() => undefined);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") recordVisibleActivity();
    }

    const interval = window.setInterval(recordVisibleActivity, 60_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [email]);

  useEffect(() => {
    if (!mobileOpen) return;

    const trigger = mobileMenuButtonRef.current;
    const dialog = mobileDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-[#eaf3ee] text-[#16221d]">
      <aside className="fixed inset-y-3 left-3 z-40 hidden w-[216px] flex-col overflow-hidden rounded-[18px] bg-[#063b2f] text-white shadow-[0_24px_64px_rgba(6,59,47,0.22)] lg:flex">
        <div className="px-5 pb-5 pt-6">
          <a
            href="/dashboard"
            aria-label="Accueil Lydoc"
            className="inline-flex"
          >
            <Brand inverse />
          </a>
          <p className="ml-[42px] mt-0.5 text-[10px] font-medium text-white/60">
            Vos démarches, simplement
          </p>
        </div>

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
          aria-label="Navigation principale"
        >
          <NavigationLinks active={active} />

          {isAdmin ? (
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className="px-3 pb-2 text-[10px] font-bold uppercase text-white/45">
                Administration
              </p>
              <SidebarLink
                item={{
                  id: "admin-clients",
                  href: "/admin/clients",
                  label: "Clients",
                  icon: Users,
                }}
                active={active === "admin-clients"}
              />
              <SidebarLink
                item={{
                  id: "admin",
                  href: "/admin/rules",
                  label: "Règlements",
                  icon: ShieldCheck,
                }}
                active={active === "admin"}
              />
              <SidebarLink
                item={{
                  id: "admin-invoices",
                  href: "/admin/invoices",
                  label: "Factures clients",
                  icon: FileText,
                }}
                active={active === "admin-invoices"}
              />
              <SidebarLink
                item={{
                  id: "admin-pricing",
                  href: "/admin/pricing",
                  label: "Tarification",
                  icon: ReceiptText,
                }}
                active={active === "admin-pricing"}
              />
            </div>
          ) : null}
        </nav>

        <div className="px-3 pb-3">
          <a
            href="/faq"
            className="flex items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-3 transition-colors hover:bg-white/[0.08]"
          >
            <span>
              <span className="block text-xs font-bold">Besoin d’aide ?</span>
              <span className="mt-1 block text-[10px] text-white/60">
                Nous sommes là.
              </span>
            </span>
            <MessageCircleMore size={23} className="shrink-0 text-[#31d39b]" />
          </a>

          <a
            href="/profile"
            className="mt-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.07]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/12 text-[10px] font-extrabold text-white">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-bold text-white/90">
                {email ?? "Mon compte"}
              </span>
              <span className="mt-0.5 block text-[9px] text-white/45">
                Compte sécurisé
              </span>
            </span>
          </a>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={logoutPending}
            className="mt-1 flex min-h-9 items-center gap-2 rounded-md px-3 text-[11px] font-semibold text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <LogOut size={14} />
            {logoutPending ? "Deconnexion…" : "Changer de compte"}
          </button>
          {logoutError ? (
            <p className="px-3 pt-2 text-[10px] text-[#ffb5a7]" role="alert">
              {logoutError}
            </p>
          ) : null}
        </div>
      </aside>

      <div className="min-w-0 lg:pl-[232px]">
        <header className="sticky top-0 z-30 flex h-[62px] items-center bg-[#063b2f] px-4 text-white shadow-sm lg:hidden">
          <button
            ref={mobileMenuButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            className="mr-3 grid h-10 w-10 place-items-center rounded-md hover:bg-white/10"
            aria-label="Ouvrir le menu"
            aria-controls="mobile-navigation-dialog"
            aria-expanded={mobileOpen}
          >
            <Menu size={21} />
          </button>
          <a href="/dashboard" aria-label="Accueil Lydoc">
            <Brand inverse />
          </a>
          <a
            href="/notifications"
            aria-label="Notifications"
            className="relative ml-auto grid h-10 w-10 place-items-center rounded-md hover:bg-white/10"
          >
            <Bell size={18} />
            {hasUnreadNotifications ? (
              <>
                <span
                  aria-hidden="true"
                  className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-[#ff8068]"
                />
                <span className="sr-only">Notifications non lues</span>
              </>
            ) : null}
          </a>
        </header>

        <main className="min-h-[calc(100vh-62px)] bg-[#fbfcfb] lg:my-3 lg:mr-3 lg:min-h-[calc(100vh-24px)] lg:rounded-[18px] lg:border lg:border-white lg:shadow-[0_18px_55px_rgba(35,71,55,0.08)]">
          {children}
        </main>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            type="button"
            aria-label="Fermer le menu"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 bg-[#071f18]/55"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            id="mobile-navigation-dialog"
            ref={mobileDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
            tabIndex={-1}
            className="relative flex h-full w-[min(86vw,310px)] flex-col bg-[#063b2f] text-white shadow-2xl"
          >
            <div className="flex h-[68px] items-center justify-between border-b border-white/10 px-5">
              <Brand inverse />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Fermer le menu"
              >
                <X size={20} />
              </button>
            </div>
            <nav
              className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
              aria-label="Navigation mobile"
            >
              <NavigationLinks
                active={active}
                onNavigate={() => setMobileOpen(false)}
              />
              {isAdmin ? (
                <div className="mt-5 border-t border-white/10 pt-5">
                  <p className="px-3 pb-2 text-[10px] font-bold uppercase text-white/45">
                    Administration
                  </p>
                  <SidebarLink
                    item={{
                      id: "admin-clients",
                      href: "/admin/clients",
                      label: "Clients",
                      icon: Users,
                    }}
                    active={active === "admin-clients"}
                    onNavigate={() => setMobileOpen(false)}
                  />
                  <SidebarLink
                    item={{
                      id: "admin",
                      href: "/admin/rules",
                      label: "Règlements",
                      icon: ShieldCheck,
                    }}
                    active={active === "admin"}
                    onNavigate={() => setMobileOpen(false)}
                  />
                  <SidebarLink
                    item={{
                      id: "admin-invoices",
                      href: "/admin/invoices",
                      label: "Factures clients",
                      icon: FileText,
                    }}
                    active={active === "admin-invoices"}
                    onNavigate={() => setMobileOpen(false)}
                  />
                  <SidebarLink
                    item={{
                      id: "admin-pricing",
                      href: "/admin/pricing",
                      label: "Tarification",
                      icon: ReceiptText,
                    }}
                    active={active === "admin-pricing"}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </div>
              ) : null}
            </nav>
            <div className="border-t border-white/10 p-3">
              <a
                href="/faq"
                className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white"
              >
                <CircleHelp size={17} /> Aide
              </a>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={logoutPending}
                className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white"
              >
                <LogOut size={17} />
                {logoutPending ? "Deconnexion…" : "Changer de compte"}
              </button>
              {logoutError ? (
                <p className="px-3 pt-2 text-xs text-[#ffb5a7]" role="alert">
                  {logoutError}
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function NavigationLinks({
  active,
  onNavigate,
}: {
  active: AppSection;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <div className="grid gap-1">
      {navigation.map((item) => (
        <SidebarLink
          key={item.id}
          item={item}
          active={active === item.id}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors ${
        active
          ? "bg-[#07976a] text-white shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
          : "text-white/72 hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      <Icon size={17} strokeWidth={active ? 2.4 : 2} />
      {item.label}
    </a>
  );
}

function accountInitials(email?: string | undefined): string {
  const localPart = email?.split("@")[0]?.replace(/[^a-z0-9]/gi, "") ?? "LY";
  return (localPart.slice(0, 2) || "LY").toUpperCase();
}
