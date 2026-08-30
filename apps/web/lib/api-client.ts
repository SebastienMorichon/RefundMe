const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const tokenRequests = new Map<string, Promise<string>>();

/** Fetch wrapper that transparently obtains and sends the API CSRF token. */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = readMethod(input, init);
  if (!unsafeMethods.has(method)) {
    return globalThis.fetch(input, withCredentials(init));
  }

  const origin = readRequestOrigin(input);
  const send = async (forceRefresh: boolean): Promise<Response> => {
    if (forceRefresh) tokenRequests.delete(origin);
    const csrfToken = await getCsrfToken(origin);
    const headers = new Headers(init.headers);
    headers.set("X-CSRF-Token", csrfToken);
    return globalThis.fetch(input, {
      ...withCredentials(init),
      headers,
    });
  };

  let response = await send(false);
  if (response.status === 403 && (await isCsrfRejection(response))) {
    await response.body?.cancel().catch(() => undefined);
    response = await send(true);
  }

  if (response.ok && requestPath(input) === "/auth/logout") {
    tokenRequests.delete(origin);
  }
  return response;
}

async function isCsrfRejection(response: Response): Promise<boolean> {
  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as Record<string, unknown>).code === "CSRF_INVALID",
  );
}

export function clearApiCsrfToken(): void {
  tokenRequests.clear();
}

function getCsrfToken(origin: string): Promise<string> {
  const existing = tokenRequests.get(origin);
  if (existing) return existing;

  const request = globalThis
    .fetch(`${origin}/auth/csrf`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    .then(async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      const csrfToken =
        payload &&
        typeof payload === "object" &&
        typeof (payload as Record<string, unknown>).csrfToken === "string"
          ? ((payload as Record<string, unknown>).csrfToken as string)
          : "";
      if (
        !response.ok ||
        !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(csrfToken)
      ) {
        throw new Error("Impossible d'initialiser la protection de la requete.");
      }
      return csrfToken;
    })
    .catch((error) => {
      tokenRequests.delete(origin);
      throw error;
    });
  tokenRequests.set(origin, request);
  return request;
}

function withCredentials(init: RequestInit): RequestInit {
  return init.credentials ? init : { ...init, credentials: "include" };
}

function readMethod(input: RequestInfo | URL, init: RequestInit): string {
  const requestMethod =
    typeof Request !== "undefined" && input instanceof Request
      ? input.method
      : "GET";
  return (init.method ?? requestMethod).toUpperCase();
}

function readRequestOrigin(input: RequestInfo | URL): string {
  return new URL(requestUrl(input), browserBaseUrl()).origin;
}

function requestPath(input: RequestInfo | URL): string {
  return new URL(requestUrl(input), browserBaseUrl()).pathname;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function browserBaseUrl(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.href;
}
