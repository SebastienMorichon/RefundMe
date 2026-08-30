DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GameRule_version_positive'
      AND conrelid = '"GameRule"'::regclass
  ) THEN
    ALTER TABLE "GameRule"
    ADD CONSTRAINT "GameRule_version_positive"
    CHECK ("version" >= 1);
  END IF;
END
$$;
