CREATE TABLE "ai_runtime_control" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "quarantined" BOOLEAN NOT NULL DEFAULT false,
  "quarantine_reason" VARCHAR(128),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_runtime_control_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_runtime_control_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "ai_runtime_control_reason_check" CHECK ("quarantined" OR "quarantine_reason" IS NULL)
);

INSERT INTO "ai_runtime_control" ("id", "quarantined", "updated_at") VALUES (1, false, now());

CREATE TABLE "ai_quota_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "usage_date" DATE NOT NULL,
  "operations_used" INTEGER NOT NULL,
  "provider_calls_used" INTEGER NOT NULL,
  "input_tokens_used" BIGINT NOT NULL,
  "output_tokens_used" BIGINT NOT NULL,
  "unknown_provider_calls" INTEGER NOT NULL,
  "enabled_after_review" BOOLEAN NOT NULL,
  "operator" VARCHAR(120) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_quota_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_quota_reconciliations_counts_check" CHECK (
    "operations_used" >= 0 AND "provider_calls_used" >= 0 AND
    "input_tokens_used" >= 0 AND "output_tokens_used" >= 0 AND "unknown_provider_calls" >= 0
  )
);

CREATE INDEX "ai_quota_reconciliations_date_created_idx"
  ON "ai_quota_reconciliations" ("usage_date", "created_at" DESC);
