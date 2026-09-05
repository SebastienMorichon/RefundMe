import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("LYDOCBKP", "ascii");
const version = Buffer.from([1]);
const saltLength = 16;
const ivLength = 12;
const tagLength = 16;
const headerLength = magic.length + version.length + saltLength + ivLength;

const [operation, inputPath, outputPath] = process.argv.slice(2);
const secret = await readSecret();
if (!operation || !inputPath || !outputPath) {
  throw new Error(
    "Usage: backup-crypto.mjs <encrypt|decrypt> <input> <output>",
  );
}
if (secret.length < 32) {
  throw new Error(
    "BACKUP_ENCRYPTION_SECRET must contain at least 32 characters.",
  );
}

if (operation === "encrypt") {
  await encrypt(inputPath, outputPath, secret);
} else if (operation === "decrypt") {
  await decrypt(inputPath, outputPath, secret);
} else {
  throw new Error("Unsupported backup crypto operation.");
}

async function encrypt(input, output, password) {
  const salt = randomBytes(saltLength);
  const iv = randomBytes(ivLength);
  const header = Buffer.concat([magic, version, salt, iv]);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const temporaryOutput = `${output}.partial`;

  try {
    const destination = createWriteStream(temporaryOutput, { flags: "wx" });
    destination.write(header);
    await pipeline(createReadStream(input), cipher, destination);
    const handle = await open(temporaryOutput, "a");
    try {
      await handle.write(cipher.getAuthTag());
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryOutput, output);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw error;
  }
}

async function decrypt(input, output, password) {
  const inputStat = await stat(input);
  if (inputStat.size <= headerLength + tagLength) {
    throw new Error("Encrypted backup artifact is truncated.");
  }

  const handle = await open(input, "r");
  let header;
  let tag;
  try {
    header = Buffer.alloc(headerLength);
    tag = Buffer.alloc(tagLength);
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, inputStat.size - tagLength);
  } finally {
    await handle.close();
  }

  if (!header.subarray(0, magic.length).equals(magic)) {
    throw new Error("Encrypted backup artifact has an invalid signature.");
  }
  if (header[magic.length] !== version[0]) {
    throw new Error("Encrypted backup artifact uses an unsupported version.");
  }

  const salt = header.subarray(
    magic.length + version.length,
    magic.length + version.length + saltLength,
  );
  const iv = header.subarray(header.length - ivLength);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const temporaryOutput = `${output}.partial`;

  try {
    await pipeline(
      createReadStream(input, {
        start: headerLength,
        end: inputStat.size - tagLength - 1,
      }),
      decipher,
      createWriteStream(temporaryOutput, { flags: "wx" }),
    );
    await rename(temporaryOutput, output);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw new Error("Backup authentication or decryption failed.", {
      cause: error,
    });
  }
}

async function readSecret() {
  if (process.env.BACKUP_ENCRYPTION_SECRET) {
    return process.env.BACKUP_ENCRYPTION_SECRET;
  }

  if (process.stdin.isTTY) {
    return "";
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  // PowerShell and POSIX pipelines append one line ending. Remove only that
  // transport delimiter so spaces inside the secret remain significant.
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}
