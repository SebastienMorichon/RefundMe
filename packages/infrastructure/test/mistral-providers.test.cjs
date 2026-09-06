const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const {
  MistralAiProvider,
  MistralOcrProvider,
} = require("../dist/index.js");

test("OCR bounds the request and accepts a valid provider response", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  let request;
  const provider = new MistralOcrProvider("test-key", {
    async fetchImpl(_url, init) {
      request = init;
      return Response.json({
        pages: [
          {
            markdown: "texte",
            confidence_scores: { average_page_confidence_score: 0.98 },
          },
        ],
      });
    },
  });

  const result = await provider.extractText({
    bytes: Buffer.from(await pdf.save()),
    mimeType: "application/pdf",
  });
  assert.equal(result.text, "texte");
  assert.equal(result.confidence, 0.98);
  assert.ok(request.signal instanceof AbortSignal);
});

test("OCR aborts a provider that exceeds the deadline", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const provider = new MistralOcrProvider("test-key", {
    timeoutMs: 5,
    fetchImpl(_url, init) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
  });

  await assert.rejects(
    provider.extractText({
      bytes: Buffer.from(await pdf.save()),
      mimeType: "application/pdf",
    }),
    /delai imparti/,
  );
});

test("OCR splits a long PDF into ordered requests", async () => {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 23; page += 1) pdf.addPage();
  let requestCount = 0;
  const provider = new MistralOcrProvider("test-key", {
    async fetchImpl() {
      requestCount += 1;
      return Response.json({
        pages: [{ markdown: `bloc-${requestCount}` }],
      });
    },
  });

  const result = await provider.extractText({
    bytes: Buffer.from(await pdf.save()),
    mimeType: "application/pdf",
  });

  assert.equal(requestCount, 3);
  assert.equal(result.text, "bloc-1\n\nbloc-2\n\nbloc-3");
  assert.deepEqual(result.raw, { pagesProcessed: 3 });
});

test("AI rejects excessive untrusted input before network access", async () => {
  const provider = new MistralAiProvider("test-key", {
    fetchImpl: async () => assert.fail("network should not be called"),
  });
  await assert.rejects(
    provider.extractStructuredData({
      documentText: "x".repeat(250_001),
      instruction: "extraire",
      locale: "fr-FR",
    }),
    /limites autorisees/,
  );
});

test("AI rejects oversized or malformed provider responses", async () => {
  const oversized = new MistralAiProvider("test-key", {
    async fetchImpl() {
      return new Response("{}", {
        headers: { "content-length": String(1024 * 1024 + 1) },
      });
    },
  });
  await assert.rejects(
    oversized.extractStructuredData({
      documentText: "document",
      instruction: "extraire",
      locale: "fr-FR",
    }),
    /trop volumineuse/,
  );

  const malformed = new MistralAiProvider("test-key", {
    async fetchImpl() {
      return new Response("not-json");
    },
  });
  await assert.rejects(
    malformed.extractStructuredData({
      documentText: "document",
      instruction: "extraire",
      locale: "fr-FR",
    }),
    /reponse invalide/,
  );
});

test("AI uses the configured model for long-document analysis", async () => {
  let request;
  const provider = new MistralAiProvider("test-key", {
    model: "mistral-large-latest",
    async fetchImpl(_url, init) {
      request = init;
      return Response.json({
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    },
  });

  const result = await provider.extractStructuredData({
    documentText: "document",
    instruction: "extraire",
    locale: "fr-FR",
  });

  assert.equal(JSON.parse(request.body).model, "mistral-large-latest");
  assert.equal(result.provider, "mistral-large-latest");
});
