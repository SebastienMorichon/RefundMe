import { randomUUID } from "node:crypto";
import type {
  DocumentWatermarkProvider,
  WatermarkDocumentInput,
  WatermarkedDocument,
} from "@lydoc/application";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";

const watermarkVersion = "refund-purpose-v1";
const maxImagePixels = 40_000_000;
const maxPdfPages = 100;
const maxPdfPagePoints = 14_400;

export class PdfImageDocumentWatermarkProvider implements DocumentWatermarkProvider {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly createReference: () => string = () =>
      randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase(),
  ) {}

  async watermark(input: WatermarkDocumentInput): Promise<WatermarkedDocument> {
    const watermarkedAt = this.now();
    const reference = this.createReference();
    const label = buildWatermarkLabel(input.kind, watermarkedAt, reference);

    try {
      const bytes =
        input.mimeType === "application/pdf"
          ? await watermarkPdf(input.bytes, label)
          : await watermarkImage(input.bytes, input.mimeType, label);

      return {
        bytes,
        version: watermarkVersion,
        reference,
        watermarkedAt,
      };
    } catch {
      throw new Error(
        "Impossible de proteger ce document. Verifiez qu'il n'est pas verrouille ou endommage.",
      );
    }
  }
}

async function watermarkPdf(
  bytes: Uint8Array,
  label: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const pages = pdf.getPages();
  if (pages.length < 1 || pages.length > maxPdfPages) {
    throw new Error("PDF page limit exceeded");
  }
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const page of pages) {
    const { width, height } = page.getSize();
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > maxPdfPagePoints ||
      height > maxPdfPagePoints
    ) {
      throw new Error("PDF page dimensions exceeded");
    }
    const fontSize = clamp(Math.round(Math.min(width, height) / 42), 10, 17);
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const rowSpacing = Math.max(105, height / 5);

    for (let y = -rowSpacing; y <= height + rowSpacing; y += rowSpacing) {
      for (let x = -width * 0.55; x <= width * 1.1; x += textWidth + 70) {
        page.drawText(label, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(0.03, 0.42, 0.29),
          opacity: 0.15,
          rotate: degrees(27),
        });
      }
    }
  }

  return pdf.save();
}

async function watermarkImage(
  bytes: Uint8Array,
  mimeType: string,
  label: string,
): Promise<Uint8Array> {
  const input = sharp(bytes, {
    failOn: "error",
    limitInputPixels: maxImagePixels,
    sequentialRead: true,
  });
  const metadata = await input.metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceWidth * sourceHeight > maxImagePixels ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new Error("Image dimensions exceeded");
  }
  const normalized = await input
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const width = normalized.info.width;
  const height = normalized.info.height;
  const fontSize = clamp(Math.round(Math.min(width, height) / 35), 16, 34);
  const tileWidth = Math.max(520, Math.round(label.length * fontSize * 0.62));
  const tileHeight = Math.max(120, fontSize * 5);
  const escapedLabel = escapeXml(label);
  const overlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="watermark" width="${tileWidth}" height="${tileHeight}" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
          <text x="10" y="${Math.round(tileHeight / 2)}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#087a55" fill-opacity="0.16">${escapedLabel}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#watermark)" />
    </svg>
  `);

  const pipeline = sharp(normalized.data).composite([{ input: overlay }]);
  return mimeType === "image/png"
    ? pipeline.png({ compressionLevel: 9 }).toBuffer()
    : pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

function buildWatermarkLabel(
  kind: WatermarkDocumentInput["kind"],
  date: Date,
  reference: string,
): string {
  const documentLabel =
    kind === "IDENTITY_DOCUMENT" ? "PIECE D'IDENTITE" : "RIB";
  return `${documentLabel} - DOSSIER DE REMBOURSEMENT UNIQUEMENT - ${date
    .toISOString()
    .slice(0, 10)} - REF ${reference}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
