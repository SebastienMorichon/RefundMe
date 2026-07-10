export type PutObjectInput = Readonly<{
  bytes: Uint8Array;
  originalName: string;
  mimeType: string;
  encryptionContext: Record<string, string>;
}>;

export type StoredObjectRef = Readonly<{
  bucket: string;
  key: string;
  checksumSha256: string;
  sizeBytes: number;
}>;

export interface ObjectStorageProvider {
  putEncryptedObject(input: PutObjectInput): Promise<StoredObjectRef>;
  getDecryptedObject(input: {
    object: StoredObjectRef;
    encryptionContext: Record<string, string>;
  }): Promise<Uint8Array>;
  getSignedReadUrl(input: StoredObjectRef, ttlSeconds: number): Promise<string>;
  deleteObject(input: StoredObjectRef): Promise<void>;
}
