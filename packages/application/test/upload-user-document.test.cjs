const assert = require("node:assert/strict");
const test = require("node:test");
const { UploadUserDocument } = require("../dist/use-cases/documents/upload-user-document.js");

const validPdf = Buffer.from("%PDF-1.7\n");

function createStorage() {
  const deleted = [];

  return {
    deleted,
    async putEncryptedObject() {
      return {
        bucket: "documents",
        key: "document.bin",
        checksumSha256: "checksum",
        sizeBytes: validPdf.length,
      };
    },
    async deleteObject(reference) {
      deleted.push(reference);
    },
  };
}

test("rejects a file whose bytes do not match its declared mime type", async () => {
  const storage = createStorage();
  const documents = { create: async () => assert.fail("repository should not be called") };
  const useCase = new UploadUserDocument(documents, storage);

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "OTHER",
      originalName: "not-a-pdf.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("not a pdf"),
    }),
    /ne correspond pas au format declare/,
  );
  assert.equal(storage.deleted.length, 0);
});

test("removes the stored object when database persistence fails", async () => {
  const storage = createStorage();
  const documents = { create: async () => { throw new Error("database unavailable"); } };
  const useCase = new UploadUserDocument(documents, storage);

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "ORANGE_INVOICE",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /database unavailable/,
  );
  assert.equal(storage.deleted.length, 1);
});
