"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const measurementId = "G-ZTGGYREXDS";
const storageKey = "lydoc-analytics-consent-v1";
const choiceLifetime = 180 * 24 * 60 * 60 * 1000;

type Choice = "accepted" | "refused" | null;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function isPublicPath(pathname: string) {
  return [
    "/",
    "/guides",
    "/faq",
    "/methode",
    "/securite",
    "/contact",
    "/cgu",
    "/cgv",
    "/confidentialite",
    "/cookies",
    "/mentions-legales",
  ].includes(pathname) || /^\/guides\/[a-z0-9-]+$/.test(pathname);
}

function readChoice(): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      value?: Choice;
      date?: number;
    } | null;
    if (
      saved &&
      (saved.value === "accepted" || saved.value === "refused") &&
      typeof saved.date === "number" &&
      Date.now() - saved.date < choiceLifetime
    ) {
      return saved.value;
    }
  } catch {
    // A blocked storage API leaves analytics disabled until a choice is possible.
  }
  return null;
}

function saveChoice(value: Exclude<Choice, null>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ value, date: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function clearAnalyticsCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0] ?? "";
    if (/^_ga(?:_|$)|^_gid$/.test(name)) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      if (window.location.hostname === "lydoc.fr" || window.location.hostname.endsWith(".lydoc.fr")) {
        document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.lydoc.fr; SameSite=Lax`;
      }
    }
  }
}

export function AnalyticsConsent() {
  const pathname = usePathname() ?? "";
  const [choice, setChoice] = useState<Choice>(null);
  const [ready, setReady] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const loaded = useRef(false);
  const trackedPath = useRef<string | null>(null);
  const publicPath = isPublicPath(pathname);

  useEffect(() => {
    setChoice(readChoice());
    setReady(true);
  }, []);

  useEffect(() => {
    const openChoices = () => setShowChoices(true);
    window.addEventListener("lydoc:cookie-settings", openChoices);
    return () => window.removeEventListener("lydoc:cookie-settings", openChoices);
  }, []);

  useEffect(() => {
    if (!ready || choice !== "accepted") return;

    if (!publicPath) {
      // A full navigation removes a tag loaded on an earlier public page.
      if (loaded.current) window.location.replace(window.location.href);
      return;
    }

    if (!loaded.current) {
      loaded.current = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = (...args: unknown[]) => window.dataLayer?.push(args);
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
      script.onload = () => {
        if (!isPublicPath(window.location.pathname)) {
          window.location.replace(window.location.href);
          return;
        }
        window.gtag?.("js", new Date());
        window.gtag?.("config", measurementId, {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          page_location: window.location.origin + window.location.pathname,
          page_referrer: "",
        });
        trackedPath.current = window.location.pathname;
        window.gtag?.("event", "page_view", {
          page_location: window.location.origin + window.location.pathname,
          page_referrer: "",
          page_title: document.title,
        });
      };
      document.head.appendChild(script);
      return;
    }

    if (window.gtag && trackedPath.current && trackedPath.current !== pathname) {
      trackedPath.current = pathname;
      window.gtag("event", "page_view", {
        page_location: window.location.origin + pathname,
        page_referrer: "",
        page_title: document.title,
      });
    }
  }, [choice, pathname, publicPath, ready]);

  function choose(value: Exclude<Choice, null>) {
    if (!saveChoice(value)) return;
    setChoice(value);
    setShowChoices(false);
    if (value === "refused" && loaded.current) {
      clearAnalyticsCookies();
      window.location.reload();
    }
  }

  if (!ready || !publicPath || (choice !== null && !showChoices)) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-[#dce5e0] bg-white p-5 shadow-[0_-8px_30px_rgba(23,33,29,0.12)]" role="dialog" aria-label="Choix des cookies de mesure d’audience">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-[#17211d]">
          Avec votre accord, Lydoc utilise Google Analytics pour mesurer la fréquentation de ses pages publiques. Vous pouvez refuser ou modifier votre choix à tout moment dans la <a className="underline" href="/cookies">politique cookies</a>.
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("refused")} className="rounded-md border border-[#aebbb4] px-4 py-2 text-sm font-bold text-[#17211d]">Refuser</button>
          <button type="button" onClick={() => choose("accepted")} className="rounded-md bg-[#087a55] px-4 py-2 text-sm font-bold text-white">Accepter</button>
        </div>
      </div>
    </div>
  );
}
