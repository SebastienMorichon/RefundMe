"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Brand } from "./brand";

const links = [
  { href: "/#fonctionnement", label: "Comment ça marche" },
  { href: "/#tarifs", label: "Offres" },
  { href: "/securite", label: "Sécurité" },
  { href: "/faq", label: "FAQ" },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#e2e8f0] bg-white/95 backdrop-blur">
      <div className="page-container flex h-[72px] items-center justify-between gap-6">
        <a href="/" className="shrink-0" aria-label="Accueil Lydoc">
          <Brand />
        </a>
        <nav
          className="hidden items-center gap-7 text-sm font-semibold text-[#43506b] lg:flex"
          aria-label="Navigation principale"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-[#087a55]"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 sm:flex">
          <a
            href="/connexion"
            className="rounded-md px-3 py-2 text-sm font-bold text-[#24332c] hover:bg-[#f1f4f8]"
          >
            Se connecter
          </a>
          <a
            href="/inscription"
            className="rounded-md bg-[#087a55] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#066344]"
          >
            Tester ma facture
          </a>
        </div>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-md border border-[#dce5e0] text-[#24332c] sm:hidden"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open ? (
        <nav
          className="border-t border-[#e2e8f0] bg-white px-5 py-4 sm:hidden"
          aria-label="Navigation mobile"
        >
          <div className="grid gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-3 text-sm font-semibold text-[#24332c] hover:bg-[#f1f4f8]"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#e2e8f0] pt-4">
              <a
                href="/connexion"
                className="rounded-md border border-[#c8d2df] px-3 py-2.5 text-center text-sm font-bold"
              >
                Se connecter
              </a>
              <a
                href="/inscription"
                className="rounded-md bg-[#087a55] px-3 py-2.5 text-center text-sm font-bold text-white"
              >
                S’inscrire
              </a>
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
