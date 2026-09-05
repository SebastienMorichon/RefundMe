const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");
const {
  PdfImageDocumentWatermarkProvider,
} = require("../dist/documents/pdf-image-document-watermark-provider.js");

function createProvider() {
  return new PdfImageDocumentWatermarkProvider(
    () => new Date("2026-08-01T10:00:00.000Z"),
    () => "ABC1234567",
  );
}

test("adds a watermark to every page of a PDF", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  source.addPage([842, 595]);
  const sourceBytes = await source.save();

  const result = await createProvider().watermark({
    bytes: sourceBytes,
    mimeType: "application/pdf",
    kind: "IDENTITY_DOCUMENT",
  });
  const output = await PDFDocument.load(result.bytes);

  assert.equal(output.getPageCount(), 2);
  assert.notDeepEqual(Buffer.from(result.bytes), Buffer.from(sourceBytes));
  assert.equal(result.version, "refund-purpose-v1");
  assert.equal(result.reference, "ABC1234567");
  assert.equal(result.watermarkedAt.toISOString(), "2026-08-01T10:00:00.000Z");
});

test("watermarks PNG images while preserving their format and dimensions", async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 600,
      channels: 3,
      background: "#ffffff",
    },
  })
    .png()
    .toBuffer();

  const result = await createProvider().watermark({
    bytes: source,
    mimeType: "image/png",
    kind: "BANK_DETAILS",
  });
  const metadata = await sharp(result.bytes).metadata();
  const stats = await sharp(result.bytes).stats();

  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 900);
  assert.equal(metadata.height, 600);
  assert.ok(stats.channels.some((channel) => channel.mean < 254.9));
});

test("watermarks JPEG images while preserving their format and dimensions", async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 600,
      channels: 3,
      background: "#ffffff",
    },
  })
    .jpeg()
    .toBuffer();

  const result = await createProvider().watermark({
    bytes: source,
    mimeType: "image/jpeg",
    kind: "IDENTITY_DOCUMENT",
  });
  const metadata = await sharp(result.bytes).metadata();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 900);
  assert.equal(metadata.height, 600);
});
