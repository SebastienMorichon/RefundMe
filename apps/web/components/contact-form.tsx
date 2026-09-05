"use client";

import { Send } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch as fetch } from "../lib/api-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function ContactForm() {
  const [status, setStatus] = useState<
    "idle" | "submitting" | "sent" | "error"
  >("idle");
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "sent" || status === "error") statusRef.current?.focus();
  }, [status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setStatus("submitting");
    try {
      const response = await fetch(`${apiUrl}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: String(values.get("firstName") ?? ""),
          lastName: String(values.get("lastName") ?? ""),
          email: String(values.get("email") ?? ""),
          subject: String(values.get("subject") ?? ""),
          message: String(values.get("message") ?? ""),
          website: String(values.get("website") ?? ""),
          consentAccepted: values.get("consentAccepted") === "on",
        }),
      });
      if (!response.ok) throw new Error("contact failed");
      form.reset();
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-bold text-[#24332c]">
          Prénom
          <input
            name="firstName"
            className="field"
            autoComplete="given-name"
            maxLength={80}
            placeholder="Jean"
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-[#24332c]">
          Nom
          <input
            name="lastName"
            className="field"
            autoComplete="family-name"
            maxLength={80}
            placeholder="Dupont"
            required
          />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-bold text-[#24332c]">
        Adresse e-mail
        <input
          name="email"
          type="email"
          className="field"
          autoComplete="email"
          maxLength={254}
          placeholder="jean@exemple.fr"
          required
        />
      </label>
      <label className="grid gap-2 text-sm font-bold text-[#24332c]">
        Votre demande
        <select name="subject" className="field" defaultValue="" required>
          <option value="" disabled>
            Choisir un sujet
          </option>
          <option value="Question sur un remboursement">
            Question sur un remboursement
          </option>
          <option value="Aide avec un document">Aide avec un document</option>
          <option value="Suivi d'un dossier">Suivi d’un dossier</option>
          <option value="Partenariat">Partenariat</option>
          <option value="Autre demande">Autre demande</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-bold text-[#24332c]">
        Message
        <textarea
          name="message"
          className="field min-h-36 resize-y"
          minLength={10}
          maxLength={4000}
          placeholder="Décrivez votre demande en quelques lignes…"
          required
        />
      </label>
      <label
        className="absolute -left-[10000px] h-px w-px overflow-hidden"
        aria-hidden="true"
      >
        Site Web
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          maxLength={200}
        />
      </label>
      <label className="flex items-start gap-3 text-xs leading-5 text-[#66736d]">
        <input
          name="consentAccepted"
          type="checkbox"
          required
          className="mt-1 h-4 w-4 accent-[#087a55]"
        />
        J’accepte que Lydoc utilise ces informations uniquement pour répondre à
        ma demande.
      </label>
      {status === "sent" || status === "error" ? (
        <div
          ref={statusRef}
          className={`border-l-4 p-4 text-sm ${
            status === "sent"
              ? "border-[#16875b] bg-[#e8f7f0] text-[#326950]"
              : "border-[#e9654b] bg-[#fff0ec] text-[#8e3d2c]"
          }`}
          role={status === "sent" ? "status" : "alert"}
          aria-live="polite"
          tabIndex={-1}
        >
          {status === "sent"
            ? "Votre message a bien été transmis. Nous vous répondrons par e-mail."
            : "Le message n’a pas pu être transmis. Réessayez dans quelques instants."}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={status === "submitting"}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#087a55] px-5 py-3 text-sm font-extrabold text-white hover:bg-[#066344] disabled:cursor-wait disabled:opacity-60 sm:w-fit"
      >
        {status === "submitting" ? "Envoi…" : "Envoyer ma demande"}
        <Send size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
