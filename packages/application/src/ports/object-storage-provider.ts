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
  getSignedReadUrl(input: StoredObjectRef, ttlSeconds: number): Promise<string>;
  deleteObject(input: StoredObjectRef): Promise<void>;
}

