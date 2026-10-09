ALTER TABLE "ai_plans"
  ADD COLUMN "clone_request_key" VARCHAR(128),
  ADD COLUMN "clone_request_hash" CHAR(64),
  ADD CONSTRAINT "ai_plans_clone_request_pair_check" CHECK (("clone_request_key" IS NULL) = ("clone_request_hash" IS NULL)),
  ADD CONSTRAINT "ai_plans_clone_request_hash_check" CHECK ("clone_request_hash" IS NULL OR "clone_request_hash" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "ai_plans_clone_request_key_key"
  ON "ai_plans" ("creator_id", "workspace_id", "team_id", "clone_request_key");

ALTER TABLE "ai_plan_versions"
  ADD CONSTRAINT "ai_plan_versions_base_fkey"
  FOREIGN KEY ("plan_id", "base_version_id") REFERENCES "ai_plan_versions" ("plan_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
