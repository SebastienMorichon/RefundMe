"use client";

export function CookieSettingsButton() {
  return (
    <button
      type="button"
      className="font-semibold text-[#087a55] underline"
      onClick={() => window.dispatchEvent(new Event("lydoc:cookie-settings"))}
    >
      Modifier mon choix
    </button>
  );
}
