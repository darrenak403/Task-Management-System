CREATE TYPE "ai_plan_status" AS ENUM ('DRAFT', 'IMPORTED', 'EXPIRED');
CREATE TYPE "ai_plan_version_source" AS ENUM ('GENERATED', 'EDITED', 'REGENERATED', 'ADJUSTED');
CREATE TYPE "ai_job_status" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED');
CREATE TYPE "ai_job_action" AS ENUM ('GENERATE', 'CLARIFY', 'RETRY');
CREATE TYPE "ai_usage_scope_type" AS ENUM ('USER', 'WORKSPACE', 'GLOBAL');

ALTER TABLE "tasks"
  ADD COLUMN "completion_criteria" VARCHAR(2000) NOT NULL DEFAULT '',
  ADD COLUMN "priority_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  ADD COLUMN "estimate_min_minutes" INTEGER,
  ADD COLUMN "estimate_max_minutes" INTEGER,
  ADD COLUMN "planned_start_date" DATE,
  ADD COLUMN "relative_start_day" INTEGER,
  ADD COLUMN "relative_due_day" INTEGER,
  ADD COLUMN "source_plan_id" UUID,
  ADD COLUMN "source_item_id" UUID,
  ADD CONSTRAINT "tasks_estimate_check" CHECK (
    ("estimate_min_minutes" IS NULL AND "estimate_max_minutes" IS NULL) OR
    ("estimate_min_minutes" BETWEEN 1 AND 525600 AND "estimate_max_minutes" BETWEEN "estimate_min_minutes" AND 525600)
  ),
  ADD CONSTRAINT "tasks_relative_days_check" CHECK (
    ("relative_start_day" IS NULL OR "relative_start_day" BETWEEN 1 AND 365) AND
    ("relative_due_day" IS NULL OR "relative_due_day" BETWEEN 1 AND 365) AND
    ("relative_start_day" IS NULL OR "relative_due_day" IS NULL OR "relative_start_day" <= "relative_due_day")
  ),
  ADD CONSTRAINT "tasks_source_pair_check" CHECK (("source_plan_id" IS NULL) = ("source_item_id" IS NULL)),
  ADD CONSTRAINT "tasks_start_due_check" CHECK ("planned_start_date" IS NULL OR "due_date" IS NULL OR "planned_start_date" <= "due_date");
CREATE UNIQUE INDEX "tasks_workspace_team_id_key" ON "tasks" ("workspace_id", "team_id", "id");
CREATE UNIQUE INDEX "tasks_source_plan_item_key" ON "tasks" ("source_plan_id", "source_item_id") WHERE "source_plan_id" IS NOT NULL;

CREATE TABLE "ai_plans" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "creator_id" UUID NOT NULL,
  "status" "ai_plan_status" NOT NULL DEFAULT 'DRAFT',
  "active_version_id" UUID,
  "imported_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ai_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_plans_workspace_team_id_key" UNIQUE ("workspace_id", "team_id", "id"),
  CONSTRAINT "ai_plans_id_active_version_id_key" UNIQUE ("id", "active_version_id"),
  CONSTRAINT "ai_plans_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "ai_plans_import_state_check" CHECK (("status" = 'IMPORTED') = ("imported_at" IS NOT NULL))
);
CREATE INDEX "ai_plans_creator_updated_at_id_idx" ON "ai_plans" ("creator_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "ai_plans_expiry_status_idx" ON "ai_plans" ("expires_at", "status");

CREATE TABLE "ai_plan_versions" (
  "id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "parent_version_id" UUID,
  "base_version_id" UUID,
  "source" "ai_plan_version_source" NOT NULL DEFAULT 'GENERATED',
  "schema_version" SMALLINT NOT NULL DEFAULT 1,
  "draft" JSONB NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "context_snapshot" JSONB,
  "field_locks" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "content_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_plan_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_plan_versions_plan_id_id_key" UNIQUE ("plan_id", "id"),
  CONSTRAINT "ai_plan_versions_plan_ordinal_key" UNIQUE ("plan_id", "ordinal"),
  CONSTRAINT "ai_plan_versions_positive_ordinal_check" CHECK ("ordinal" > 0),
  CONSTRAINT "ai_plan_versions_schema_check" CHECK ("schema_version" > 0),
  CONSTRAINT "ai_plan_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_plan_versions_payload_size_check" CHECK (pg_column_size("draft") <= 2097152 AND pg_column_size("input_snapshot") <= 262144 AND ("context_snapshot" IS NULL OR pg_column_size("context_snapshot") <= 262144)),
  CONSTRAINT "ai_plan_versions_locks_array_check" CHECK (jsonb_typeof("field_locks") = 'array')
);
CREATE INDEX "ai_plan_versions_plan_created_at_id_idx" ON "ai_plan_versions" ("plan_id", "created_at" DESC, "id" DESC);

CREATE TABLE "ai_jobs" (
  "id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "creator_id" UUID NOT NULL,
  "credential_revision" UUID NOT NULL,
  "retry_root_id" UUID NOT NULL,
  "attempt_limit" INTEGER NOT NULL DEFAULT 4,
  "usage_date" DATE NOT NULL,
  "max_input_tokens" INTEGER NOT NULL,
  "max_output_tokens" INTEGER NOT NULL,
  "action" "ai_job_action" NOT NULL DEFAULT 'GENERATE',
  "status" "ai_job_status" NOT NULL DEFAULT 'QUEUED',
  "request_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "input" JSONB NOT NULL,
  "stages" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "checkpoint" JSONB,
  "current_stage" VARCHAR(40),
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "provider_attempts" INTEGER NOT NULL DEFAULT 0,
  "provider_attempt_started_at" TIMESTAMPTZ(6),
  "provider_attempt_unknown" BOOLEAN NOT NULL DEFAULT FALSE,
  "provider_calls_used" INTEGER NOT NULL DEFAULT 0,
  "input_tokens_used" INTEGER NOT NULL DEFAULT 0,
  "output_tokens_used" INTEGER NOT NULL DEFAULT 0,
  "quota_settled" BOOLEAN NOT NULL DEFAULT FALSE,
  "model" VARCHAR(128) NOT NULL,
  "prompt_version" VARCHAR(32) NOT NULL,
  "output_version_id" UUID,
  "safe_error_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_jobs_request_key_key" UNIQUE ("creator_id", "workspace_id", "team_id", "request_key"),
  CONSTRAINT "ai_jobs_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_jobs_stages_array_check" CHECK (jsonb_typeof("stages") = 'array'),
  CONSTRAINT "ai_jobs_payload_size_check" CHECK (pg_column_size("input") <= 262144),
  CONSTRAINT "ai_jobs_sequence_check" CHECK ("sequence" >= 0 AND "attempt" >= 0 AND "provider_attempts" BETWEEN 0 AND 4 AND "provider_calls_used" = "provider_attempts" AND "attempt_limit" BETWEEN 1 AND 4 AND "max_input_tokens" > 0 AND "max_output_tokens" > 0),
  CONSTRAINT "ai_jobs_lease_check" CHECK (("lease_token" IS NULL) = ("lease_expires_at" IS NULL)),
  CONSTRAINT "ai_jobs_terminal_time_check" CHECK (("status" IN ('QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION')) = ("finished_at" IS NULL)),
  CONSTRAINT "ai_jobs_quota_state_check" CHECK (("status" IN ('QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION')) <> "quota_settled")
);
CREATE INDEX "ai_jobs_creator_created_at_id_idx" ON "ai_jobs" ("creator_id", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_jobs_status_created_at_id_idx" ON "ai_jobs" ("status", "created_at", "id");
CREATE INDEX "ai_jobs_lease_status_idx" ON "ai_jobs" ("lease_expires_at", "status");
CREATE INDEX "ai_jobs_plan_created_at_id_idx" ON "ai_jobs" ("plan_id", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_jobs_retry_root_idx" ON "ai_jobs" ("retry_root_id", "created_at", "id");
CREATE UNIQUE INDEX "ai_jobs_one_active_per_creator_idx" ON "ai_jobs" ("creator_id") WHERE "status" IN ('QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION');

CREATE TABLE "ai_imports" (
  "plan_id" UUID NOT NULL,
  "confirmed_version_id" UUID NOT NULL,
  "request_key" VARCHAR(128) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "item_task_map" JSONB NOT NULL,
  "response" JSONB NOT NULL,
  "committed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_imports_pkey" PRIMARY KEY ("plan_id"),
  CONSTRAINT "ai_imports_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_imports_size_check" CHECK (pg_column_size("item_task_map") <= 262144 AND pg_column_size("response") <= 262144)
);

CREATE TABLE "ai_usage_daily" (
  "scope_type" "ai_usage_scope_type" NOT NULL,
  "scope_id" UUID NOT NULL,
  "usage_date" DATE NOT NULL,
  "operations_reserved" INTEGER NOT NULL DEFAULT 0,
  "operations_used" INTEGER NOT NULL DEFAULT 0,
  "calls_reserved" INTEGER NOT NULL DEFAULT 0,
  "calls_used" INTEGER NOT NULL DEFAULT 0,
  "input_tokens_reserved" BIGINT NOT NULL DEFAULT 0,
  "input_tokens_used" BIGINT NOT NULL DEFAULT 0,
  "output_tokens_reserved" BIGINT NOT NULL DEFAULT 0,
  "output_tokens_used" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("scope_type", "scope_id", "usage_date"),
  CONSTRAINT "ai_usage_daily_nonnegative_check" CHECK ("operations_reserved" >= 0 AND "operations_used" >= 0 AND "calls_reserved" >= 0 AND "calls_used" >= 0 AND "input_tokens_reserved" >= 0 AND "input_tokens_used" >= 0 AND "output_tokens_reserved" >= 0 AND "output_tokens_used" >= 0),
  CONSTRAINT "ai_usage_daily_global_id_check" CHECK (("scope_type" = 'GLOBAL') = ("scope_id" = '00000000-0000-0000-0000-000000000000'::uuid))
);
CREATE INDEX "ai_usage_daily_date_scope_idx" ON "ai_usage_daily" ("usage_date", "scope_type");

CREATE TABLE "task_subtasks" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "is_completed" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "task_subtasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_subtasks_task_position_key" UNIQUE ("task_id", "position"),
  CONSTRAINT "task_subtasks_position_check" CHECK ("position" >= 0),
  CONSTRAINT "task_subtasks_title_check" CHECK ("title" = btrim("title") AND char_length("title") BETWEEN 1 AND 200)
);

CREATE TABLE "task_dependencies" (
  "workspace_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "prerequisite_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("task_id", "prerequisite_id"),
  CONSTRAINT "task_dependencies_no_self_check" CHECK ("task_id" <> "prerequisite_id")
);
CREATE INDEX "task_dependencies_prerequisite_idx" ON "task_dependencies" ("workspace_id", "team_id", "prerequisite_id");

ALTER TABLE "ai_plans"
  ADD CONSTRAINT "ai_plans_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_plans_workspace_team_fkey" FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams" ("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_plans_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_plan_versions"
  ADD CONSTRAINT "ai_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_plan_versions_parent_fkey" FOREIGN KEY ("plan_id", "parent_version_id") REFERENCES "ai_plan_versions" ("plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_scope_plan_fkey" FOREIGN KEY ("workspace_id", "team_id", "plan_id") REFERENCES "ai_plans" ("workspace_id", "team_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_jobs_scope_team_fkey" FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams" ("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_jobs_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_jobs_output_version_fkey" FOREIGN KEY ("plan_id", "output_version_id") REFERENCES "ai_plan_versions" ("plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_imports"
  ADD CONSTRAINT "ai_imports_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "ai_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_imports_version_fkey" FOREIGN KEY ("plan_id", "confirmed_version_id") REFERENCES "ai_plan_versions" ("plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_subtasks"
  ADD CONSTRAINT "task_subtasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_task_fkey" FOREIGN KEY ("workspace_id", "team_id", "task_id") REFERENCES "tasks" ("workspace_id", "team_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "task_dependencies_prerequisite_fkey" FOREIGN KEY ("workspace_id", "team_id", "prerequisite_id") REFERENCES "tasks" ("workspace_id", "team_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_source_plan_fkey" FOREIGN KEY ("source_plan_id") REFERENCES "ai_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_plans"
  ADD CONSTRAINT "ai_plans_active_version_fkey" FOREIGN KEY ("id", "active_version_id") REFERENCES "ai_plan_versions" ("plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
