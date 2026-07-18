"use client";

import {
  Bell,
  CircleHelp,
  FileCheck2,
  FileText,
  FolderKanban,
  Gauge,
  LogOut,
  Menu,
  Plus,
  ReceiptText,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Brand } from "./brand";

type AppShellProps = {
  children: ReactNode;
  active?: "dashboard" | "documents" | "cases" | "profile" | "admin" | "admin-invoices";
  email?: string | undefined;
  isAdmin?: boolean;
};

const navigation = [
  { id: "dashboard", href: "/dashboard", label: "Vue d’ensemble", icon: Gauge },
  { id: "documents", href: "/dashboard#documents", label: "Mes documents", icon: FileText },
  { id: "cases", href: "/dashboard#dossiers", label: "Mes dossiers", icon: FolderKanban },
  { id: "refunds", href: "/dashboard#remboursements", label: "Remboursements", icon: ReceiptText },
];

export function AppShell({ children, active = "dashboard", email, isAdmin = false }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const initials = email?.slice(0, 2).toUpperCase() ?? "LY";

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-[#111b35] lg:grid lg:grid-cols-[252px_1fr]">
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[252px] flex-col bg-[#102544] lg:flex">
        <div className="flex h-[76px] items-center border-b border-white/10 px-6">
          <a href="/dashboard" aria-label="Tableau de bord Lydoc"><Brand inverse /></a>
        </div>
        <div className="px-4 py-5">
          <a href="/dashboard#deposer" className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-extrabold text-[#102544] hover:bg-[#eef3f9]">
            <Plus size={17} /> Déposer une facture
          </a>
        </div>
        <nav className="grid gap-1 px-3" aria-label="Navigation de l’espace client">
          {navigation.map((item) => {
            const Icon = item.icon;
            const selected = active === item.id;
            return (
              <a key={item.id} href={item.href} className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold ${selected ? "bg-white/[0.12] text-white" : "text-[#bdc9dc] hover:bg-white/[0.07] hover:text-white"}`}>
                <Icon size={18} aria-hidden="true" /> {item.label}
              </a>
            );
          })}
          {isAdmin ? (
            <>
              <a href="/admin/rules" className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold ${active === "admin" ? "bg-white/[0.12] text-white" : "text-[#bdc9dc] hover:bg-white/[0.07] hover:text-white"}`}>
                <ShieldCheck size={18} /> Règlements
              </a>
              <a href="/admin/invoices" className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold ${active === "admin-invoices" ? "bg-white/[0.12] text-white" : "text-[#bdc9dc] hover:bg-white/[0.07] hover:text-white"}`}>
                <FileText size={18} /> Factures clients
              </a>
            </>
          ) : null}
        </nav>
        <div className="mt-auto border-t border-white/10 px-3 py-4">
          <a href="/faq" className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#bdc9dc] hover:bg-white/[0.07] hover:text-white"><CircleHelp size={18} /> Aide</a>
          <a href="/profile" className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold ${active === "profile" ? "bg-white/[0.12] text-white" : "text-[#bdc9dc] hover:bg-white/[0.07] hover:text-white"}`}><Settings size={18} /> Paramètres</a>
          <a href="/connexion" className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#bdc9dc] hover:bg-white/[0.07] hover:text-white"><LogOut size={18} /> Changer de compte</a>
        </div>
      </aside>

      <div className="min-w-0 lg:col-start-2">
        <header className="sticky top-0 z-40 flex h-[68px] items-center justify-between border-b border-[#dce3ed] bg-white/95 px-4 backdrop-blur sm:px-7 lg:px-9">
          <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-md border border-[#dce3ed] lg:hidden" aria-label="Ouvrir le menu"><Menu size={20} /></button>
          <div className="hidden lg:block">
            <p className="text-xs font-semibold text-[#7a8499]">Espace personnel</p>
            <p className="text-sm font-extrabold text-[#102544]">Mes remboursements</p>
          </div>
          <a href="/dashboard" className="lg:hidden"><Brand /></a>
          <div className="flex items-center gap-2">
            <button type="button" className="relative grid h-10 w-10 place-items-center rounded-md text-[#536078] hover:bg-[#edf2f8]" aria-label="Notifications">
              <Bell size={19} />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-[#e9654b]" />
            </button>
            <div className="hidden h-8 w-px bg-[#e2e8f0] sm:block" />
            <div className="flex items-center gap-2 pl-1">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-[#e5ecff] text-xs font-extrabold text-[#2457f5]">{initials}</span>
              <div className="hidden max-w-[190px] sm:block">
                <p className="truncate text-sm font-bold text-[#102544]">{email ?? "Mon compte"}</p>
                <p className="text-xs text-[#7a8499]">Compte sécurisé</p>
              </div>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button type="button" className="absolute inset-0 bg-[#07152a]/[0.55]" aria-label="Fermer le menu" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-[286px] max-w-[86vw] flex-col bg-[#102544] p-4 text-white">
            <div className="flex items-center justify-between px-2 py-2">
              <Brand inverse />
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-md text-white hover:bg-white/10" aria-label="Fermer"><X size={20} /></button>
            </div>
            <a href="/dashboard#deposer" onClick={() => setOpen(false)} className="my-5 flex min-h-11 items-center justify-center gap-2 rounded-md bg-white text-sm font-extrabold text-[#102544]"><Plus size={17} /> Déposer une facture</a>
            <nav className="grid gap-1">
              {navigation.map((item) => {
                const Icon = item.icon;
                return <a key={item.id} href={item.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#d2dbea] hover:bg-white/10"><Icon size={18} /> {item.label}</a>;
              })}
              {isAdmin ? <><a href="/admin/rules" className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#d2dbea]"><FileCheck2 size={18} /> Règlements</a><a href="/admin/invoices" className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#d2dbea]"><FileText size={18} /> Factures clients</a></> : null}
              <a href="/profile" className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#d2dbea]"><Settings size={18} /> Paramètres</a>
            </nav>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
