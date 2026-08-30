const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EncryptedSensitiveTextProvider,
} = require("../dist/storage/encrypted-sensitive-text-provider.js");

const oldSecret = "old-sensitive-text-secret-with-32-characters";
const newSecret = "new-sensitive-text-secret-with-32-characters";

test("encrypts OCR text and binds it to its document", () => {
  const provider = new EncryptedSensitiveTextProvider(
    newSecret,
    "primary-2026-08",
  );
  const encrypted = provider.encrypt("IBAN FR76 private", "ocr:document-1");
  assert.match(encrypted, /^LYDOC-TEXT-2\./);
  assert.equal(encrypted.includes("IBAN"), false);
  assert.equal(
    provider.decrypt(encrypted, "ocr:document-1"),
    "IBAN FR76 private",
  );
  assert.throws(() => provider.decrypt(encrypted, "ocr:document-2"));
});

test("decrypts OCR text after key rotation and accepts legacy plaintext", () => {
  const oldProvider = new EncryptedSensitiveTextProvider(
    oldSecret,
    "primary-2026-07",
  );
  const encrypted = oldProvider.encrypt("old OCR text", "ocr:document-1");
  const newProvider = new EncryptedSensitiveTextProvider(
    newSecret,
    "primary-2026-08",
    { "primary-2026-07": oldSecret },
  );
  assert.equal(newProvider.decrypt(encrypted, "ocr:document-1"), "old OCR text");
  assert.equal(newProvider.decrypt("legacy plaintext", "ocr:document-1"), "legacy plaintext");
});
