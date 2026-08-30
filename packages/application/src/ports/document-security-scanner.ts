export type DocumentSecurityScanInput = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
}>;

/**
 * Parses and rewrites an uploaded document before it reaches durable storage.
 * Implementations must fail closed when the payload is malformed, encrypted,
 * structurally excessive or contains active content.
 */
export interface DocumentSecurityScanner {
  sanitize(input: DocumentSecurityScanInput): Promise<Uint8Array>;
}
