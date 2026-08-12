-- Migration 0001: Multi-tenancy foundation
-- Creates: session table, tenants, users, tenant_dids, audit_log
-- Seeds:   one "default" tenant + one OWNER user (password: voxagent)

-- Session table for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey') THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"region" text DEFAULT 'global' NOT NULL,
	"webhook_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'ANALYST' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_dids" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"did_e164" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_dids_did_e164_unique" UNIQUE("did_e164")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenant_dids" ADD CONSTRAINT "tenant_dids_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ─── Seed: default tenant + OWNER user ─────────────────────────────────────
-- Tenant ID and User ID are fixed so migration 0002 can reference them.
-- Password for admin@voxagent.local is "voxagent" (bcrypt, 10 rounds).
INSERT INTO "tenants" ("id", "name", "slug", "status", "region", "webhook_secret")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Organisation',
  'default',
  'active',
  'global',
  'voxagent-webhook-secret-default'
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "users" ("id", "tenant_id", "email", "password_hash", "role", "status")
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'admin@voxagent.local',
  '$2b$10$CnRNW0qvkdMpOCnryzsL9.rQfN/hN14qWGq0GwOAHR836DpTHsrDe',
  'OWNER',
  'active'
) ON CONFLICT ("id") DO NOTHING;
