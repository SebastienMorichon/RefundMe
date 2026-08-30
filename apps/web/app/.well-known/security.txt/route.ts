const sixMonthsInSeconds = 15_552_000;

export const dynamic = "force-dynamic";

export function GET() {
  const email = process.env.SECURITY_CONTACT_EMAIL?.trim() ?? "";
  const applicationUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (!isEmail(email) || !isTrustedOrigin(applicationUrl)) {
    return new Response("Security contact is not configured.\n", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const origin = new URL(applicationUrl).origin;
  const expiresAt = new Date(Date.now() + sixMonthsInSeconds * 1_000);
  const body = [
    `Contact: mailto:${email}`,
    `Expires: ${expiresAt.toISOString()}`,
    "Preferred-Languages: fr, en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/securite`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isTrustedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (process.env.NODE_ENV !== "production" && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}
