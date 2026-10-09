CREATE TABLE "realtime_clock" (
  "id" INTEGER NOT NULL,
  "epoch" UUID NOT NULL,
  "last_seq" BIGINT NOT NULL DEFAULT 0,
  "watermark_id" UUID NOT NULL,
  "epoch_checkpoint_id" UUID NOT NULL,
  "purged_through" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "realtime_clock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "realtime_clock_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "realtime_clock_seq_check" CHECK ("last_seq" >= 0 AND "purged_through" >= 0 AND "purged_through" <= "last_seq")
);

INSERT INTO "realtime_clock" ("id", "epoch", "last_seq", "watermark_id", "epoch_checkpoint_id", "purged_through")
VALUES (1, gen_random_uuid(), 0, gen_random_uuid(), gen_random_uuid(), 0);

UPDATE "realtime_clock"
SET "watermark_id" = "epoch_checkpoint_id";

CREATE TABLE "realtime_events" (
  "id" UUID NOT NULL,
  "epoch" UUID NOT NULL,
  "seq" BIGINT NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "schema_version" SMALLINT NOT NULL DEFAULT 1,
  "workspace_id" UUID,
  "team_id" UUID,
  "target_user_id" UUID,
  "target_session_hash" CHAR(64),
  "resource_id" UUID,
  "payload" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "realtime_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "realtime_events_epoch_seq_key" UNIQUE ("epoch", "seq"),
  CONSTRAINT "realtime_events_positive_seq_check" CHECK ("seq" > 0),
  CONSTRAINT "realtime_events_type_check" CHECK ("event_type" ~ '^[a-z][a-z0-9_.]{0,63}$'),
  CONSTRAINT "realtime_events_schema_version_check" CHECK ("schema_version" > 0),
  CONSTRAINT "realtime_events_session_hash_check" CHECK ("target_session_hash" IS NULL OR "target_session_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "realtime_events_payload_object_check" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "realtime_events_scope_check" CHECK ("workspace_id" IS NOT NULL OR "target_user_id" IS NOT NULL OR "target_session_hash" IS NOT NULL)
);

CREATE INDEX "realtime_events_scope_idx" ON "realtime_events" ("workspace_id", "team_id", "epoch", "seq");
CREATE INDEX "realtime_events_target_user_idx" ON "realtime_events" ("target_user_id", "epoch", "seq") WHERE "target_user_id" IS NOT NULL;
CREATE INDEX "realtime_events_target_session_idx" ON "realtime_events" ("target_session_hash", "epoch", "seq") WHERE "target_session_hash" IS NOT NULL;
CREATE INDEX "realtime_events_retention_idx" ON "realtime_events" ("recorded_at", "seq");
