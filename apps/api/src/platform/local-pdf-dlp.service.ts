import { Injectable, Logger } from "@nestjs/common";
import { PDFDocument } from "pdf-lib";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const defaultMaximumPages = 6;
const maximumRenderedBytes = 96 * 1024 * 1024;
const maximumRenderedPageBytes = 24 * 1024 * 1024;
const maximumExtractedCharacters = 1_000_000;

export type LocalAiDocumentClassification = Readonly<{
  accepted: boolean;
  reason:
    | "TRUSTED_ORANGE_INVOICE"
    | "SENSITIVE_MARKERS"
    | "AMBIGUOUS_CONTENT"
    | "UNSUPPORTED_LOCAL_CLASSIFICATION";
}>;

export class LocalPdfDlpUnavailableError extends Error {}
export class LocalPdfDlpBusyError extends Error {}

/**
 * Renders PDFs and OCRs the visible pixels locally before an external provider
 * can receive the original. Raw PDF strings are deliberately never trusted:
 * hidden, clipped or off-page text must not be able to authorize transmission.
 */
@Injectable()
export class LocalPdfDlpService {
  private readonly logger = new Logger(LocalPdfDlpService.name);
  private active = 0;
  private readonly concurrency = readBoundedInteger(
    process.env.AI_LOCAL_DLP_CONCURRENCY,
    2,
    1,
    8,
  );
  private readonly maximumPages = readBoundedInteger(
    process.env.AI_LOCAL_DLP_MAX_PAGES,
    defaultMaximumPages,
    1,
    20,
  );

  async classify(input: {
    bytes: Uint8Array;
    declaredKind: string;
    mimeType: string;
  }): Promise<LocalAiDocumentClassification> {
    if (
      input.declaredKind !== "ORANGE_INVOICE" ||
      input.mimeType.toLowerCase() !== "application/pdf" ||
      !Buffer.from(input.bytes).subarray(0, 5).equals(Buffer.from("%PDF-"))
    ) {
      return {
        accepted: false,
        reason: "UNSUPPORTED_LOCAL_CLASSIFICATION",
      };
    }
    if (this.active >= this.concurrency) {
      throw new LocalPdfDlpBusyError(
        "Le service local de controle documentaire est occupe.",
      );
    }

    this.active += 1;
    try {
      const visibleText = await renderAndOcrVisiblePdfText(
        input.bytes,
        this.maximumPages,
      );
      return classifyVisibleOrangeInvoiceText(visibleText);
    } catch (error) {
      this.logger.error(
        "Local PDF privacy classification failed.",
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    } finally {
      this.active = Math.max(0, this.active - 1);
    }
  }
}

export function classifyVisibleOrangeInvoiceText(
  visibleText: string,
): LocalAiDocumentClassification {
  const text = normalizeVisibleText(visibleText);
  if (!text) {
    return { accepted: false, reason: "AMBIGUOUS_CONTENT" };
  }

  const sensitivePatterns = [
    /\bcarte nationale d identite\b/,
    /\bidentity card\b/,
    /\bpasseport\b/,
    /\bpassport\b/,
    /\breleve d identite bancaire\b/,
    /\btitulaire du compte\b/,
    /\bi\s*b\s*a\s*n\b/,
    /\bcode b\s*i\s*c\b/,
    /\br\s+i\s+b\b/,
    /\bnumero de securite sociale\b/,
    /\bdate de naissance\b/,
    /\bfr\s*\d{2}(?:\s*[a-z0-9]){20,30}\b/,
  ];
  if (sensitivePatterns.some((pattern) => pattern.test(text))) {
    return { accepted: false, reason: "SENSITIVE_MARKERS" };
  }

  const hasTrustedTelecomIssuer = [
    /\borange(?: france| sa)?\b/,
    /\bbouygues\s*telecom\b/,
    /\bsfr\b/,
    /\bfree(?: mobile| telecom)?\b/,
  ].some((pattern) => pattern.test(text));
  const invoiceMarkers = [
    "facture",
    "montant",
    "total",
    "tva",
    "abonnement",
    "numero client",
    "telephone",
    "mobile",
  ].filter((marker) => text.includes(marker)).length;

  return hasTrustedTelecomIssuer && invoiceMarkers >= 3
    ? { accepted: true, reason: "TRUSTED_ORANGE_INVOICE" }
    : { accepted: false, reason: "AMBIGUOUS_CONTENT" };
}

async function renderAndOcrVisiblePdfText(
  bytes: Uint8Array,
  maximumPages: number,
): Promise<string> {
  let pageCount: number;
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    pageCount = pdf.getPageCount();
  } catch {
    return "";
  }
  if (pageCount < 1 || pageCount > maximumPages) {
    return "";
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), "lydoc-local-dlp-"));
  const inputPath = join(workingDirectory, "document.pdf");
  const pagePrefix = join(workingDirectory, "page");
  // OCR on the production VPS can take more than eight seconds per page.
  // Keep the rendering resolution sufficient for invoices while allowing
  // slower multi-page documents to finish their local privacy check.
  const deadline = Date.now() + 75_000;
  try {
    await writeFile(inputPath, bytes, { mode: 0o600 });
    await executeBoundedProcess(
      "pdftoppm",
      [
        "-f",
        "1",
        "-l",
        String(pageCount),
        "-gray",
        "-png",
        "-r",
        "120",
        "-scale-to",
        "1800",
        inputPath,
        pagePrefix,
      ],
      Math.max(1_000, Math.min(20_000, deadline - Date.now())),
      64 * 1024,
    );

    const renderedPages = (await readdir(workingDirectory))
      .filter((name) => /^page-\d+\.png$/u.test(name))
      .sort((left, right) => numericPage(left) - numericPage(right));
    if (renderedPages.length !== pageCount) return "";

    let totalRenderedBytes = 0;
    const extracted: string[] = [];
    for (const page of renderedPages) {
      const pagePath = join(workingDirectory, page);
      const pageSize = (await stat(pagePath)).size;
      totalRenderedBytes += pageSize;
      if (
        pageSize < 1 ||
        pageSize > maximumRenderedPageBytes ||
        totalRenderedBytes > maximumRenderedBytes
      ) {
        return "";
      }
      const remaining = deadline - Date.now();
      if (remaining < 1_000) {
        throw new LocalPdfDlpUnavailableError(
          "Le controle local du document a depasse son delai.",
        );
      }
      const output = await executeBoundedProcess(
        "tesseract",
        [pagePath, "stdout", "-l", "fra+eng", "--psm", "6"],
        Math.min(15_000, remaining),
        maximumExtractedCharacters,
      );
      extracted.push(output);
      if (extracted.join("\n").length > maximumExtractedCharacters) {
        return "";
      }
    }
    return extracted.join("\n");
  } catch (error) {
    if (error instanceof LocalPdfDlpUnavailableError) throw error;
    throw new LocalPdfDlpUnavailableError(
      "Le controle local du document est indisponible.",
      { cause: error },
    );
  } finally {
    await rm(workingDirectory, { force: true, recursive: true });
  }
}

function executeBoundedProcess(
  command: string,
  args: string[],
  timeoutMilliseconds: number,
  outputLimit: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError: Error | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      terminalError = new LocalPdfDlpUnavailableError(
        "Le controle local du document a depasse son delai.",
      );
      child.kill("SIGKILL");
    }, timeoutMilliseconds);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > outputLimit) {
        terminalError = new LocalPdfDlpUnavailableError(
          "La sortie du controle local est excessive.",
        );
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.once("error", (error) => {
      terminalError = error;
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminalError) {
        reject(terminalError);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Le processus local a echoue (${code ?? "signal"}): ${Buffer.concat(stderr).toString("utf8").slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

function normalizeVisibleText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function numericPage(name: string): number {
  return Number(name.match(/page-(\d+)\.png$/u)?.[1] ?? 0);
}

function readBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
