import type {
  DocumentSecurityScanInput,
  DocumentSecurityScanner,
} from "@lydoc/application";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObject,
  PDFRef,
  PDFStream,
} from "pdf-lib";
import sharp from "sharp";

const maxImagePixels = 40_000_000;
const maxPdfPages = 100;
const maxPdfPagePoints = 14_400;
const forbiddenPdfTokens = [
  /\/JavaScript\b/i,
  /\/JS\b/i,
  /\/Launch\b/i,
  /\/EmbeddedFile\b/i,
  /\/OpenAction\b/i,
  /\/RichMedia\b/i,
  /\/XFA\b/i,
  /\/SubmitForm\b/i,
  /\/ImportData\b/i,
  /\/GoToR\b/i,
  /\/GoToE\b/i,
];
const forbiddenPdfDictionaryKeys = new Set([
  "AA",
  "AcroForm",
  "AF",
  "Alternates",
  "Annots",
  "EF",
  "EmbeddedFile",
  "EmbeddedFiles",
  "FDecodeParms",
  "FFilter",
  "FS",
  "JavaScript",
  "JS",
  "Launch",
  "OPI",
  "OpenAction",
  "Ref",
  "RF",
  "RichMedia",
  "XFA",
]);
const forbiddenPdfNameValues = new Set([
  "EmbeddedFile",
  "FileAttachment",
  "Filespec",
  "GoTo3DView",
  "GoToE",
  "GoToR",
  "Hide",
  "ImportData",
  "JavaScript",
  "Launch",
  "Movie",
  "Named",
  "Rendition",
  "ResetForm",
  "RichMedia",
  "Screen",
  "SetOCGState",
  "Sound",
  "SubmitForm",
  "Thread",
  "Trans",
  "Widget",
  "PS",
  "PostScript",
]);
const allowedCopiedPageKeys = new Set([
  "ArtBox",
  "BleedBox",
  "Contents",
  "CropBox",
  "Group",
  "MediaBox",
  "Parent",
  "Resources",
  "Rotate",
  "TrimBox",
  "Type",
  "UserUnit",
]);

export class PdfImageDocumentSecurityScanner implements DocumentSecurityScanner {
  async sanitize(input: DocumentSecurityScanInput): Promise<Uint8Array> {
    try {
      return input.mimeType === "application/pdf"
        ? await sanitizePdf(input.bytes)
        : await sanitizeImage(input.bytes, input.mimeType);
    } catch (error) {
      if (error instanceof UnsafeDocumentError) throw error;
      throw new UnsafeDocumentError(
        "Le document est endommage, verrouille ou impossible a analyser en securite.",
      );
    }
  }
}

class UnsafeDocumentError extends Error {}

async function sanitizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const raw = Buffer.from(bytes);
  if (!raw.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new UnsafeDocumentError("Le fichier PDF contient un en-tete invalide.");
  }
  const tail = raw.subarray(Math.max(0, raw.length - 2048)).toString("latin1");
  if (!tail.includes("%%EOF")) {
    throw new UnsafeDocumentError("Le fichier PDF est incomplet.");
  }
  const source = raw.toString("latin1");
  if (forbiddenPdfTokens.some((pattern) => pattern.test(source))) {
    throw new UnsafeDocumentError(
      "Les PDF contenant des scripts, pieces jointes ou actions automatiques sont refuses.",
    );
  }

  const pdf = await PDFDocument.load(raw, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const inspected = new Set<PDFObject>();
  stripPassiveLinkAnnotations(pdf, inspected);
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (forbiddenPdfTokens.some((pattern) => pattern.test(object.toString()))) {
      throwActivePdfError();
    }
    assertPassivePdfObject(object, pdf, inspected);
  }
  const pages = pdf.getPages();
  if (pages.length < 1 || pages.length > maxPdfPages) {
    throw new UnsafeDocumentError(
      `Le PDF doit contenir entre 1 et ${maxPdfPages} pages.`,
    );
  }
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
      throw new UnsafeDocumentError("Une page du PDF a des dimensions excessives.");
    }
  }

  // Rebuild a page-only document. This intentionally drops the source catalog,
  // metadata, outlines, forms, name trees and unreferenced incremental objects.
  const rebuilt = await PDFDocument.create();
  const copiedPages = await rebuilt.copyPages(pdf, pdf.getPageIndices());
  for (const page of copiedPages) {
    for (const key of page.node.keys()) {
      if (!allowedCopiedPageKeys.has(key.decodeText())) page.node.delete(key);
    }
    rebuilt.addPage(page);
  }
  return rebuilt.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: false,
  });
}

function stripPassiveLinkAnnotations(
  pdf: PDFDocument,
  inspected: Set<PDFObject>,
): void {
  for (const page of pdf.getPages()) {
    const value = page.node.get(PDFName.of("Annots"));
    if (!value) continue;
    const annotations = value instanceof PDFRef ? pdf.context.lookup(value) : value;
    if (!(annotations instanceof PDFArray)) throwActivePdfError();

    for (const entry of annotations.asArray()) {
      const annotation = entry instanceof PDFRef ? pdf.context.lookup(entry) : entry;
      if (!(annotation instanceof PDFDict)) throwActivePdfError();
      const subtype = annotation.get(PDFName.of("Subtype"));
      if (!(subtype instanceof PDFName) || subtype.decodeText() !== "Link") {
        throwActivePdfError();
      }
      const actionValue = annotation.get(PDFName.of("A"));
      if (actionValue) {
        const action = actionValue instanceof PDFRef
          ? pdf.context.lookup(actionValue)
          : actionValue;
        if (!(action instanceof PDFDict)) throwActivePdfError();
        const actionType = action.get(PDFName.of("S"));
        const uri = action.get(PDFName.of("URI"));
        if (
          !(actionType instanceof PDFName) ||
          actionType.decodeText() !== "URI" ||
          !uri ||
          action.has(PDFName.of("Next"))
        ) {
          throwActivePdfError();
        }
        inspected.add(action);
        if (actionValue instanceof PDFRef) inspected.add(actionValue);
      }
      inspected.add(annotation);
      if (entry instanceof PDFRef) inspected.add(entry);
    }
    inspected.add(annotations);
    if (value instanceof PDFRef) inspected.add(value);
    page.node.delete(PDFName.of("Annots"));
  }
}

function assertPassivePdfObject(
  object: PDFObject,
  pdf: PDFDocument,
  inspected: Set<PDFObject>,
): void {
  if (inspected.has(object)) return;
  inspected.add(object);

  if (object instanceof PDFRef) {
    const resolved = pdf.context.lookup(object);
    if (resolved) assertPassivePdfObject(resolved, pdf, inspected);
    return;
  }

  if (object instanceof PDFName) {
    if (forbiddenPdfNameValues.has(object.decodeText())) throwActivePdfError();
    return;
  }

  if (object instanceof PDFStream) {
    if (object.dict.has(PDFName.of("F"))) throwActivePdfError();
    assertPassivePdfObject(object.dict, pdf, inspected);
    return;
  }

  if (object instanceof PDFDict) {
    const objectType = object.get(PDFName.of("Type"));
    if (
      objectType instanceof PDFName &&
      objectType.decodeText() === "XObject"
    ) {
      const subtype = object.get(PDFName.of("Subtype"));
      if (
        !(subtype instanceof PDFName) ||
        (subtype.decodeText() !== "Image" &&
          subtype.decodeText() !== "Form")
      ) {
        throwActivePdfError();
      }
    }
    for (const [key, value] of object.entries()) {
      const keyName = key.decodeText();
      if (keyName === "Annots") {
        const annotations =
          value instanceof PDFRef ? pdf.context.lookup(value) : value;
        if (annotations instanceof PDFArray && annotations.size() === 0) {
          continue;
        }
        throwActivePdfError();
      }
      if (forbiddenPdfDictionaryKeys.has(keyName)) {
        throwActivePdfError();
      }
      assertPassivePdfObject(value, pdf, inspected);
    }
    return;
  }

  if (object instanceof PDFArray) {
    for (const value of object.asArray()) {
      assertPassivePdfObject(value, pdf, inspected);
    }
  }
}

function throwActivePdfError(): never {
  throw new UnsafeDocumentError(
    "Les PDF contenant des formulaires, liens, annotations, pieces jointes ou actions sont refuses.",
  );
}

async function sanitizeImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
    throw new UnsafeDocumentError("Format d'image non accepte.");
  }
  const input = sharp(bytes, {
    failOn: "error",
    limitInputPixels: maxImagePixels,
    sequentialRead: true,
  });
  const metadata = await input.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    width < 1 ||
    height < 1 ||
    width * height > maxImagePixels ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new UnsafeDocumentError(
      "L'image est animee ou ses dimensions sont excessives.",
    );
  }

  const normalized = input.rotate().flatten({ background: "#ffffff" });
  return mimeType === "image/png"
    ? normalized.png({ compressionLevel: 9 }).toBuffer()
    : normalized.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
