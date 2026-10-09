ALTER TABLE "user_gemini_credentials"
  ADD COLUMN "model" VARCHAR(128),
  ADD CONSTRAINT "user_gemini_credentials_model_check" CHECK (
    "model" IS NULL OR "model" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  );
