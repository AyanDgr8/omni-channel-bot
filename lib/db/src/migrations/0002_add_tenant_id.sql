-- Migration 0002: Add tenant_id to all domain tables
-- Safe for existing databases: adds columns as nullable, backfills from the
-- seeded default tenant (00000000-0000-0000-0000-000000000001), then
-- enforces NOT NULL.

-- ─── Step 1: Add all columns as nullable ────────────────────────────────────
ALTER TABLE "bots"                  ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "calls"                 ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "persona_config"        ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "conversation_config"   ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "llm_config"            ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "memory_entries"        ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "calendar_invites"      ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "message_logs"          ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "flow_configs"          ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "writing_style_profiles" ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "personas"              ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "persona_traits"        ADD COLUMN IF NOT EXISTS "tenant_id" text;
-- email_agent_config gets vox_tenant_id to avoid collision with ms tenant_id
ALTER TABLE "email_agent_config"    ADD COLUMN IF NOT EXISTS "vox_tenant_id" text;

--> statement-breakpoint

-- ─── Step 2: Backfill all existing rows to the default tenant ───────────────
UPDATE "bots"                  SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "calls"                 SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "persona_config"        SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "conversation_config"   SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "llm_config"            SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "memory_entries"        SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "calendar_invites"      SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "message_logs"          SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "flow_configs"          SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "writing_style_profiles" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "personas"              SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "persona_traits"        SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
UPDATE "email_agent_config"    SET "vox_tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "vox_tenant_id" IS NULL;

--> statement-breakpoint

-- ─── Step 3: Enforce NOT NULL ────────────────────────────────────────────────
ALTER TABLE "bots"                  ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "calls"                 ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "persona_config"        ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "conversation_config"   ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "llm_config"            ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "memory_entries"        ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "calendar_invites"      ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "message_logs"          ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "flow_configs"          ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "writing_style_profiles" ALTER COLUMN "tenant_id"   SET NOT NULL;
ALTER TABLE "personas"              ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "persona_traits"        ALTER COLUMN "tenant_id"     SET NOT NULL;
ALTER TABLE "email_agent_config"    ALTER COLUMN "vox_tenant_id" SET NOT NULL;
