"use client";

import { CheckCircle2, Euro, LoaderCircle, MessageSquareText } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { formatCents } from "../lib/client-data";

export function DetectionReviewCard({
  smsCount,
  amountCents,
  isBusy,
  submitLabel = "Enregistrer",
  onSubmit,
}: {
  smsCount: number;
  amountCents: number;
  isBusy: boolean;
  submitLabel?: string;
  onSubmit: (smsCount: number, amountCents: number) => Promise<void>;
}) {
  const [countValue, setCountValue] = useState(String(smsCount));
  const [amountValue, setAmountValue] = useState(formatEuroInput(amountCents));
  const [validationMessage, setValidationMessage] = useState("");

  useEffect(() => {
    setCountValue(String(smsCount));
    setAmountValue(formatEuroInput(amountCents));
  }, [smsCount, amountCents]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCount = Number(countValue);
    const parsedAmountCents = parseEuroInput(amountValue);
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 1_000) {
      setValidationMessage("Saisissez un nombre de SMS compris entre 1 et 1000.");
      return;
    }
    if (parsedAmountCents === null || parsedAmountCents < 1) {
      setValidationMessage("Saisissez un montant total valide.");
      return;
    }
    setValidationMessage("");
    await onSubmit(parsedCount, parsedAmountCents);
  }

  const parsedCount = Number(countValue);
  const parsedAmount = parseEuroInput(amountValue);
  const unitAmount = Number.isInteger(parsedCount) && parsedCount > 0 && parsedAmount
    ? Math.round(parsedAmount / parsedCount)
    : null;

  return (
    <form onSubmit={(event) => void submit(event)} className="surface overflow-hidden">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_180px_210px_auto] lg:items-start">
        <div className="min-w-0 lg:self-center">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-[#e8f6ef] text-[#087a55]">
            <MessageSquareText size={19} />
          </span>
          <h2 className="mt-3 text-base font-extrabold text-[#17211d]">Vérifiez vos informations</h2>
          <p className="mt-1 text-xs leading-5 text-[#66736d]">
            Corrigez le nombre de SMS ou le montant si nécessaire.
          </p>
        </div>

        <label className="grid gap-2 text-xs font-extrabold text-[#526058]">
          SMS envoyés
          <span className="relative">
            <MessageSquareText size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#87938d]" />
            <input
              type="number"
              min={1}
              max={1000}
              step={1}
              inputMode="numeric"
              value={countValue}
              onChange={(event) => setCountValue(event.target.value)}
              disabled={isBusy}
              className="field field-with-leading-icon"
              aria-label="Nombre de SMS envoyés"
            />
          </span>
        </label>

        <label className="grid gap-2 text-xs font-extrabold text-[#526058]">
          Montant total
          <span className="relative">
            <Euro size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#87938d]" />
            <input
              type="text"
              inputMode="decimal"
              value={amountValue}
              onChange={(event) => setAmountValue(event.target.value)}
              disabled={isBusy}
              className="field field-with-leading-icon-and-suffix"
              aria-label="Montant total des SMS en euros"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-extrabold text-[#87938d]">EUR</span>
          </span>
          <span className="font-normal text-[#7b8781]">
            {unitAmount ? `${formatCents(unitAmount)} par SMS` : "Montant facturé"}
          </span>
        </label>

        <button type="submit" disabled={isBusy} className="primary-button min-h-11 whitespace-nowrap px-5 lg:mt-[1.35rem]">
          {isBusy ? <LoaderCircle className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
          {submitLabel}
        </button>
      </div>
      {validationMessage ? (
        <p className="border-t border-[#f0c7ba] bg-[#fff4f0] px-5 py-3 text-xs font-bold text-[#a34732] sm:px-6" role="alert">
          {validationMessage}
        </p>
      ) : null}
    </form>
  );
}

function formatEuroInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function parseEuroInput(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}
