CREATE TYPE "workspace_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "task_status" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
CREATE TYPE "task_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- Prisma's uuid() and @updatedAt values are supplied by the client, so align
-- the older bootstrap migration with the schema's client-side defaults.
ALTER TABLE "sessions" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "user_gemini_credentials" ALTER COLUMN "credential_revision" DROP DEFAULT;
ALTER TABLE "user_gemini_credentials" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE TABLE "workspaces" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspaces_name_check" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100)
);

CREATE TABLE "workspace_members" (
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "workspace_role" NOT NULL DEFAULT 'MEMBER',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id")
);
CREATE INDEX "workspace_members_user_id_workspace_id_idx" ON "workspace_members" ("user_id", "workspace_id");
CREATE UNIQUE INDEX "workspace_members_one_owner_per_workspace_key" ON "workspace_members" ("workspace_id") WHERE "role" = 'OWNER';

CREATE TABLE "teams" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teams_name_check" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100)
);
CREATE INDEX "teams_workspace_created_at_id_idx" ON "teams" ("workspace_id", "created_at", "id");
CREATE UNIQUE INDEX "teams_workspace_id_id_key" ON "teams" ("workspace_id", "id");

CREATE TABLE "team_members" (
  "workspace_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id", "user_id")
);
CREATE INDEX "team_members_workspace_user_team_idx" ON "team_members" ("workspace_id", "user_id", "team_id");

CREATE TABLE "tasks" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "assignee_id" UUID,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "task_status" NOT NULL DEFAULT 'TODO',
  "priority" "task_priority" NOT NULL DEFAULT 'MEDIUM',
  "due_date" DATE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tasks_title_check" CHECK ("title" = btrim("title") AND char_length("title") BETWEEN 1 AND 200),
  CONSTRAINT "tasks_description_length_check" CHECK (char_length("description") <= 5000),
  CONSTRAINT "tasks_due_date_check" CHECK ("due_date" IS NULL OR (isfinite("due_date") AND EXTRACT(YEAR FROM "due_date") BETWEEN 1 AND 9999))
);
CREATE INDEX "tasks_workspace_team_created_at_id_idx" ON "tasks" ("workspace_id", "team_id", "created_at" DESC, "id" DESC);
CREATE INDEX "tasks_workspace_team_status_created_at_id_idx" ON "tasks" ("workspace_id", "team_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "tasks_workspace_due_date_idx" ON "tasks" ("workspace_id", "due_date");
CREATE INDEX "tasks_team_assignee_idx" ON "tasks" ("team_id", "assignee_id");

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "workspace_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teams"
  ADD CONSTRAINT "teams_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_workspace_team_fkey"
  FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams" ("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "team_members_workspace_user_fkey"
  FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members" ("workspace_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_workspace_team_fkey"
  FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams" ("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tasks_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tasks_team_assignee_fkey"
  FOREIGN KEY ("team_id", "assignee_id") REFERENCES "team_members" ("team_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
