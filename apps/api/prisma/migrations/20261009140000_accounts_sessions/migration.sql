CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(254) NOT NULL,
  "password_hash" TEXT NOT NULL,
  "display_name" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_normalized_check" CHECK ("email" = lower(btrim("email"))),
  CONSTRAINT "users_email_length_check" CHECK (char_length("email") BETWEEN 3 AND 254),
  CONSTRAINT "users_password_hash_nonempty_check" CHECK (char_length("password_hash") > 0),
  CONSTRAINT "users_display_name_trimmed_check" CHECK ("display_name" IS NULL OR ("display_name" = btrim("display_name") AND char_length("display_name") BETWEEN 1 AND 80))
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "sessions_expiry_after_creation_check" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_gemini_credentials" (
  "user_id" UUID NOT NULL,
  "provider" VARCHAR(16) NOT NULL DEFAULT 'GEMINI',
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "authentication_tag" BYTEA NOT NULL,
  "encryption_key_version" VARCHAR(64) NOT NULL,
  "credential_revision" UUID NOT NULL DEFAULT gen_random_uuid(),
  "verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_gemini_credentials_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_gemini_credentials_provider_check" CHECK ("provider" = 'GEMINI'),
  CONSTRAINT "user_gemini_credentials_ciphertext_check" CHECK (octet_length("ciphertext") > 0),
  CONSTRAINT "user_gemini_credentials_nonce_length_check" CHECK (octet_length("nonce") = 12),
  CONSTRAINT "user_gemini_credentials_tag_length_check" CHECK (octet_length("authentication_tag") = 16),
  CONSTRAINT "user_gemini_credentials_key_version_check" CHECK (char_length("encryption_key_version") BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX "user_gemini_credentials_revision_key" ON "user_gemini_credentials"("credential_revision");

ALTER TABLE "user_gemini_credentials"
  ADD CONSTRAINT "user_gemini_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
