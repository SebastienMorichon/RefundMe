"use client";

import { Send } from "lucide-react";
import { FormEvent, useState } from "react";

export function ContactForm() {
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = `${String(values.get("firstName") ?? "")} ${String(values.get("lastName") ?? "")}`.trim();
    const email = String(values.get("email") ?? "");
    const subject = String(values.get("subject") ?? "Demande Lydoc");
    const message = String(values.get("message") ?? "");
    const body = [`Nom : ${name}`, `E-mail : ${email}`, "", message].join("\n");
    window.location.href = `mailto:contact@lydoc.fr?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  }

  if (sent) {
    return (
      <div className="border-l-4 border-[#16875b] bg-[#e8f7f0] p-6" role="status">
        <p className="text-lg font-extrabold text-[#0d6845]">Votre messagerie a été ouverte.</p>
        <p className="mt-2 text-sm leading-6 text-[#326950]">Vérifiez le message préparé, puis envoyez-le depuis votre application de messagerie.</p>
        <button type="button" onClick={() => setSent(false)} className="mt-5 text-sm font-extrabold text-[#0d6845] underline underline-offset-4">Envoyer un autre message</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-[#26334f]">Prénom<input name="firstName" className="field" autoComplete="given-name" placeholder="Jean" required /></label>
        <label className="grid gap-2 text-sm font-bold text-[#26334f]">Nom<input name="lastName" className="field" autoComplete="family-name" placeholder="Dupont" required /></label>
      </div>
      <label className="grid gap-2 text-sm font-bold text-[#26334f]">Adresse e-mail<input name="email" type="email" className="field" autoComplete="email" placeholder="jean@exemple.fr" required /></label>
      <label className="grid gap-2 text-sm font-bold text-[#26334f]">Votre demande<select name="subject" className="field" defaultValue=""><option value="" disabled>Choisir un sujet</option><option>Question sur un remboursement</option><option>Aide avec un document</option><option>Suivi d’un dossier</option><option>Partenariat</option><option>Autre demande</option></select></label>
      <label className="grid gap-2 text-sm font-bold text-[#26334f]">Message<textarea name="message" className="field min-h-36 resize-y" placeholder="Décrivez votre demande en quelques lignes…" required /></label>
      <label className="flex items-start gap-3 text-xs leading-5 text-[#667189]"><input type="checkbox" required className="mt-1 h-4 w-4 accent-[#2457f5]" />J’accepte que Lydoc utilise ces informations uniquement pour répondre à ma demande.</label>
      <button className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#2457f5] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#1947d8] sm:w-fit">Envoyer ma demande <Send size={16} /></button>
    </form>
  );
}
