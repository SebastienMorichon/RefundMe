export type BoundedJsonRequestOptions = Readonly<{
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}>;

export async function boundedJsonRequest(
  url: string,
  init: RequestInit,
  options: BoundedJsonRequestOptions,
): Promise<{ response: Response; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > options.maxResponseBytes
    ) {
      throw new Error("La reponse du fournisseur externe est trop volumineuse.");
    }

    const text = await readBoundedBody(response, options.maxResponseBytes);
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new Error("Le fournisseur externe a retourne une reponse invalide.");
      }
    }
    return { response, payload };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Le fournisseur externe n'a pas repondu dans le delai imparti.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel();
        throw new Error("La reponse du fournisseur externe est trop volumineuse.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
