import type {
  ObjectStorageProvider,
  PutObjectInput,
  StoredObjectRef,
} from "@lydoc/application";

export class S3ObjectStorageProvider implements ObjectStorageProvider {
  async putEncryptedObject(input: PutObjectInput): Promise<StoredObjectRef> {
    void input;
    throw new Error("S3 encrypted storage adapter is not implemented yet.");
  }

  async getDecryptedObject(input: {
    object: StoredObjectRef;
    encryptionContext: Record<string, string>;
  }): Promise<Uint8Array> {
    void input;
    throw new Error("S3 encrypted storage adapter is not implemented yet.");
  }

  async getSignedReadUrl(input: StoredObjectRef, ttlSeconds: number): Promise<string> {
    void input;
    void ttlSeconds;
    throw new Error("S3 signed URL adapter is not implemented yet.");
  }

  async deleteObject(input: StoredObjectRef): Promise<void> {
    void input;
    throw new Error("S3 delete adapter is not implemented yet.");
  }
}
