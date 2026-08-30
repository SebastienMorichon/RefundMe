ALTER TABLE "User"
  ADD COLUMN "accountDeletedAt" TIMESTAMP(3);

CREATE INDEX "User_accountDeletedAt_idx"
  ON "User"("accountDeletedAt");

ALTER TABLE "User"
  ADD CONSTRAINT "User_deleted_account_state_check" CHECK (
    "accountDeletedAt" IS NULL OR (
      "role" = 'USER' AND
      "emailVerifiedAt" IS NULL AND
      "firstName" IS NULL AND
      "lastName" IS NULL AND
      "postalAddress" IS NULL AND
      "postalCode" IS NULL AND
      "city" IS NULL AND
      "country" IS NULL AND
      "phoneNumber" IS NULL AND
      "operatorCustomerReference" IS NULL AND
      "mfaSecretEncrypted" IS NULL AND
      "mfaEnabledAt" IS NULL AND
      "mfaLastUsedStep" IS NULL
    )
  );

-- Close the request/authentication TOCTOU window at the database boundary.
-- The FOR SHARE lock conflicts with account erasure's explicit user-row lock,
-- so a write either commits before erasure and is included in its snapshot, or
-- resumes afterwards and is rejected.
CREATE FUNCTION "reject_deleted_user_reference"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_user_id TEXT;
  deleted_at TIMESTAMP(3);
BEGIN
  referenced_user_id := to_jsonb(NEW) ->> TG_ARGV[0];
  IF referenced_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "accountDeletedAt"
  INTO deleted_at
  FROM "User"
  WHERE "id" = referenced_user_id
  FOR SHARE;
  IF deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'write refused for deleted account'
      USING ERRCODE = '23514', CONSTRAINT = 'active_user_reference_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Document_active_owner_required"
  BEFORE INSERT OR UPDATE OF "ownerId" ON "Document"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_user_reference"('ownerId');
CREATE TRIGGER "AdministrativeCase_active_owner_required"
  BEFORE INSERT OR UPDATE OF "ownerId" ON "AdministrativeCase"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_user_reference"('ownerId');
CREATE TRIGGER "DocumentUploadReservation_active_owner_required"
  BEFORE INSERT OR UPDATE OF "ownerId" ON "DocumentUploadReservation"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_user_reference"('ownerId');
CREATE TRIGGER "UserSession_active_user_required"
  BEFORE INSERT OR UPDATE OF "userId" ON "UserSession"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_user_reference"('userId');
CREATE TRIGGER "IdentityToken_active_user_required"
  BEFORE INSERT OR UPDATE OF "userId" ON "IdentityToken"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_user_reference"('userId');
CREATE TRIGGER "NotificationDelivery_active_user_required"
  BEFORE INSERT OR UPDATE OF "userId" ON "NotificationDelivery"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_user_reference"('userId');

CREATE FUNCTION "reject_deleted_document_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_at TIMESTAMP(3);
BEGIN
  SELECT u."accountDeletedAt"
  INTO deleted_at
  FROM "Document" d
  JOIN "User" u ON u."id" = d."ownerId"
  WHERE d."id" = NEW."documentId";
  IF deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'derived write refused for deleted account'
      USING ERRCODE = '23514', CONSTRAINT = 'active_document_owner_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OcrResult_active_document_owner_required"
  BEFORE INSERT OR UPDATE ON "OcrResult"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_document_owner"();
CREATE TRIGGER "DocumentAnalysis_active_document_owner_required"
  BEFORE INSERT OR UPDATE ON "DocumentAnalysis"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_document_owner"();

CREATE FUNCTION "reject_deleted_case_document_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_owner_count INTEGER;
BEGIN
  PERFORM 1
  FROM "User" u
  WHERE u."id" IN (
    SELECT c."ownerId" FROM "AdministrativeCase" c WHERE c."id" = NEW."caseId"
    UNION
    SELECT d."ownerId" FROM "Document" d WHERE d."id" = NEW."documentId"
  )
  ORDER BY u."id"
  FOR SHARE;
  SELECT count(*)
  INTO deleted_owner_count
  FROM "User" u
  WHERE u."id" IN (
    SELECT c."ownerId" FROM "AdministrativeCase" c WHERE c."id" = NEW."caseId"
    UNION
    SELECT d."ownerId" FROM "Document" d WHERE d."id" = NEW."documentId"
  )
  AND u."accountDeletedAt" IS NOT NULL;
  IF deleted_owner_count > 0 THEN
    RAISE EXCEPTION 'attachment refused for deleted account'
      USING ERRCODE = '23514', CONSTRAINT = 'active_case_document_owner_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CaseDocument_active_owners_required"
  BEFORE INSERT OR UPDATE OF "caseId", "documentId" ON "CaseDocument"
  FOR EACH ROW EXECUTE FUNCTION "reject_deleted_case_document_owner"();
