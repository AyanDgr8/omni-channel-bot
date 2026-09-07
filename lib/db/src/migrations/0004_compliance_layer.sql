-- ────────────────────────────────────────────────────────────────────────────
-- 0004_compliance_layer.sql  (MySQL)
--
-- Tenant-scoped DNC, consent, jurisdiction policy, and decision evidence.
-- Ported from the upstream PostgreSQL migration. Differences:
--   * `jsonb` becomes `json`. MySQL forbids a *literal* DEFAULT on a JSON
--     column, so array defaults use the 8.0.13+ expression-default form
--     `DEFAULT (CAST('[...]' AS JSON))`.
--   * `timestamp with time zone` becomes `timestamp`/`datetime`; the pool
--     forces every session to UTC (see lib/db/src/index.ts).
--   * Indexes are declared inline so `CREATE TABLE IF NOT EXISTS` covers them
--     — MySQL has no `CREATE INDEX IF NOT EXISTS`.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `dnc_entries` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `phone_number` varchar(32) NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'manual',
  `reason` text,
  `added_at` timestamp NOT NULL DEFAULT (now()),
  `expires_at` datetime NULL,
  `created_by_user_id` varchar(64),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `dnc_entries_tenant_phone_idx` (`tenant_id`, `phone_number`)
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `consent_ledger` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `phone_number` varchar(32) NOT NULL,
  `consent_type` varchar(32) NOT NULL DEFAULT 'VOICE_CALLING',
  `status` varchar(32) NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'manual',
  `captured_at` timestamp NOT NULL DEFAULT (now()),
  `expires_at` datetime NULL,
  `evidence` text,
  `actor_user_id` varchar(64),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `consent_ledger_lookup_idx` (`tenant_id`, `phone_number`, `consent_type`, `captured_at`)
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `compliance_profiles` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `jurisdiction_code` varchar(32) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `timezone` varchar(64) NOT NULL DEFAULT 'UTC',
  `calling_window_start` varchar(8) NOT NULL DEFAULT '09:00',
  `calling_window_end` varchar(8) NOT NULL DEFAULT '21:00',
  `allowed_days` json NOT NULL DEFAULT (CAST('["MON","TUE","WED","THU","FRI","SAT","SUN"]' AS JSON)),
  `holidays` json NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `require_consent` boolean NOT NULL DEFAULT false,
  `require_recording_consent` boolean NOT NULL DEFAULT false,
  `mandatory_disclosure_text` text,
  `block_on_holiday` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `compliance_profiles_tenant_jurisdiction_idx` (`tenant_id`, `jurisdiction_code`)
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `compliance_decisions` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `call_id` varchar(64),
  `bot_id` varchar(64) NOT NULL,
  `phone_number` varchar(32) NOT NULL,
  `direction` varchar(16) NOT NULL,
  `decision` varchar(32) NOT NULL,
  `reason_code` varchar(64) NOT NULL,
  `reason` text NOT NULL,
  `jurisdiction_code` varchar(32) NOT NULL,
  `called_party_timezone` varchar(64) NOT NULL,
  `disclosure_text` text,
  `recording_consent_required` boolean NOT NULL DEFAULT false,
  `evaluated_at` timestamp NOT NULL DEFAULT (now()),
  `metadata_json` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `compliance_decisions_tenant_evaluated_idx` (`tenant_id`, `evaluated_at`)
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `compliance_media_events` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `call_id` varchar(64) NOT NULL,
  `event_type` varchar(64) NOT NULL,
  `evidence` text NOT NULL,
  `occurred_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `compliance_media_events_tenant_call_idx` (`tenant_id`, `call_id`, `occurred_at` DESC)
) ENGINE=InnoDB;
--> statement-breakpoint

ALTER TABLE `calls`
  ADD COLUMN `disclosure_text` text NULL,
  ADD COLUMN `disclosure_played_at` datetime NULL,
  ADD COLUMN `recording_consent_status` varchar(32) NULL,
  ADD COLUMN `recording_consent_at` datetime NULL,
  ADD COLUMN `compliance_decision_id` varchar(64) NULL;
--> statement-breakpoint

-- A safe default for each current tenant. New tenants are initialised lazily by
-- the compliance service, so this stays compatible with tenant creation.
INSERT INTO `compliance_profiles`
  (`id`, `tenant_id`, `jurisdiction_code`, `display_name`, `timezone`)
SELECT CONCAT('cp-', t.id, '-default'), t.id, 'DEFAULT', 'Default calling policy', 'UTC'
FROM `tenants` t
WHERE NOT EXISTS (
  SELECT 1 FROM `compliance_profiles` p
  WHERE p.tenant_id = t.id AND p.jurisdiction_code = 'DEFAULT'
);
--> statement-breakpoint

INSERT INTO `compliance_profiles`
  (`id`, `tenant_id`, `jurisdiction_code`, `display_name`, `timezone`, `mandatory_disclosure_text`)
SELECT CONCAT('cp-', t.id, '-in'), t.id, 'IN', 'India calling policy', 'Asia/Kolkata',
       'You are speaking with an AI assistant on behalf of VoxAgent.'
FROM `tenants` t
WHERE NOT EXISTS (
  SELECT 1 FROM `compliance_profiles` p
  WHERE p.tenant_id = t.id AND p.jurisdiction_code = 'IN'
);
