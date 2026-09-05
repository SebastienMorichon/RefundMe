const assert = require("node:assert/strict");
const test = require("node:test");
const { createCipheriv, createHash } = require("node:crypto");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const {
  LocalEncryptedObjectStorageProvider,
} = require("../dist/storage/local-encrypted-object-storage-provider.js");

const oldSecret = "old-secret-value-with-at-least-32-characters";
const currentSecret = "current-secret-value-with-at-least-32-characters";
const context = { ownerId: "user-1", documentKind: "OTHER" };

async function createTemporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "lydoc-storage-test-"));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir())));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("writes LYDOC2 and decrypts with the bound context", async (t) => {
  const root = await createTemporaryRoot(t);
  const provider = new LocalEncryptedObjectStorageProvider(
    root,
    "documents",
    currentSecret,
    "primary-2026-08",
  );
  const object = await provider.putEncryptedObject({
    bytes: Buffer.from("private document"),
    mimeType: "application/pdf",
    encryptionContext: context,
  });

  const decrypted = await provider.getDecryptedObject({ object, encryptionContext: context });
  assert.equal(Buffer.from(decrypted).toString(), "private document");
  await assert.rejects(
    provider.getDecryptedObject({
      object,
      encryptionContext: { ...context, ownerId: "other-user" },
    }),
  );
});

test("decrypts data after a key rotation", async (t) => {
  const root = await createTemporaryRoot(t);
  const oldProvider = new LocalEncryptedObjectStorageProvider(
    root,
    "documents",
    oldSecret,
    "primary-2026-07",
  );
  const object = await oldProvider.putEncryptedObject({
    bytes: Buffer.from("rotated document"),
    mimeType: "application/pdf",
    encryptionContext: context,
  });
  const rotatedProvider = new LocalEncryptedObjectStorageProvider(
    root,
    "documents",
    currentSecret,
    "primary-2026-08",
    { "primary-2026-07": oldSecret },
  );

  const decrypted = await rotatedProvider.getDecryptedObject({ object, encryptionContext: context });
  assert.equal(Buffer.from(decrypted).toString(), "rotated document");
});

test("keeps backward read compatibility with LYDOC1 payloads", async (t) => {
  const root = await createTemporaryRoot(t);
  const key = "2026-08-03/00000000-0000-4000-8000-000000000001.bin";
  const destination = join(root, "documents", key);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, createLegacyPayload(Buffer.from("legacy"), oldSecret, context));

  const provider = new LocalEncryptedObjectStorageProvider(
    root,
    "documents",
    currentSecret,
    "primary-2026-08",
    { "primary-2026-07": oldSecret },
  );
  const decrypted = await provider.getDecryptedObject({
    object: { bucket: "documents", key, checksumSha256: "unused", sizeBytes: 6 },
    encryptionContext: context,
  });
  assert.equal(Buffer.from(decrypted).toString(), "legacy");
});

test("rejects storage traversal and foreign buckets", async (t) => {
  const root = await createTemporaryRoot(t);
  const provider = new LocalEncryptedObjectStorageProvider(
    root,
    "documents",
    currentSecret,
    "primary-2026-08",
  );
  await assert.rejects(
    provider.deleteObject({
      bucket: "documents",
      key: "../../outside.bin",
      checksumSha256: "unused",
      sizeBytes: 1,
    }),
    /reference de stockage est invalide/,
  );
  await assert.rejects(
    provider.deleteObject({
      bucket: "another-bucket",
      key: "2026-08-03/00000000-0000-4000-8000-000000000001.bin",
      checksumSha256: "unused",
      sizeBytes: 1,
    }),
    /reference de stockage est invalide/,
  );
});

test("fails closed before writing when the free-space reserve is exhausted", async (t) => {
  const root = await createTemporaryRoot(t);
  const provider = new LocalEncryptedObjectStorageProvider(
    root,
    "documents",
    currentSecret,
    "primary-2026-08",
    {},
    Number.MAX_SAFE_INTEGER,
  );

  await assert.rejects(
    provider.putEncryptedObject({
      bytes: Buffer.from("private document"),
      mimeType: "application/pdf",
      encryptionContext: context,
    }),
    /capacite maximale/,
  );
});

function createLegacyPayload(bytes, secret, encryptionContext) {
  const iv = Buffer.alloc(12, 7);
  const key = createHash("sha256").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(encryptionContext), "utf8"));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from("LYDOC1"), iv, cipher.getAuthTag(), encrypted]);
}
