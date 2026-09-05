-- Identity and bank documents are watermarked locally and are no longer
-- inspected by an AI provider. Remove the obsolete validation surface.
ALTER TABLE "Document"
  DROP COLUMN IF EXISTS "validationStatus",
  DROP COLUMN IF EXISTS "validationProvider",
  DROP COLUMN IF EXISTS "validationResultJson",
  DROP COLUMN IF EXISTS "validationConfidence",
  DROP COLUMN IF EXISTS "validatedAt";

DROP TYPE IF EXISTS "DocumentValidationStatus";
