-- ────────────────────────────────────────────────────────────────────────────
-- 0006_campaign_engine.sql  (MySQL)
--
-- Outbound campaign engine: campaigns, their contact queue, per-call
-- dispositions, and scheduled callbacks.
--
-- Upstream shipped the dial-attempt lease columns as a follow-up migration
-- (0009_campaign_claim_leases). These tables are new here, so the lease
-- columns are declared inline instead.
--
-- MySQL forbids a literal DEFAULT on a JSON column; the 8.0.13+ expression
-- form `DEFAULT (CAST(... AS JSON))` is used instead. TEXT columns cannot take
-- a DEFAULT at all, so `objective_prompt` is defaulted in JS (see the Drizzle
-- schema) rather than in DDL.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `campaigns` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `bot_id` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `objective_prompt` text NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'DRAFT',
  `schedule_json` json NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `calling_window_override` json,
  `concurrency_cap` int NOT NULL DEFAULT 1,
  `retry_policy_json` json NOT NULL DEFAULT (CAST('{"max_attempts":3,"spacing_minutes":30,"per_outcome":{}}' AS JSON)),
  `success_fields_json` json NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `cli_number` varchar(32),
  `voicemail_script` text,
  `ab_variant_of` varchar(64),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `campaigns_tenant_status_idx` (`tenant_id`, `status`)
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `campaign_contacts` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `phone_e164` varchar(32) NOT NULL,
  `variables_json` json NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `state` varchar(32) NOT NULL DEFAULT 'PENDING',
  `attempts` int NOT NULL DEFAULT 0,
  `next_attempt_at` datetime NOT NULL,
  `last_disposition` varchar(64),
  `block_reason` varchar(128),
  `call_id` varchar(64),
  `lease_token` varchar(64),
  `lease_expires_at` datetime NULL,
  `lease_error` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `campaign_contacts_campaign_phone_idx` (`campaign_id`, `phone_e164`),
  KEY `campaign_contacts_due_idx` (`tenant_id`, `state`, `next_attempt_at`),
  KEY `campaign_contacts_lease_idx` (`tenant_id`, `state`, `lease_expires_at`)
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `dispositions` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `campaign_contact_id` varchar(64),
  `call_id` varchar(64) NOT NULL,
  `code` varchar(64) NOT NULL,
  `summary_text` text,
  `extracted_fields_json` json NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `dispositions_call_idx` (`call_id`)
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `callbacks` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) NOT NULL,
  `campaign_contact_id` varchar(64) NOT NULL,
  `call_id` varchar(64),
  `scheduled_for` datetime NOT NULL,
  `note` text,
  `fulfilled` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `callbacks_due_idx` (`tenant_id`, `scheduled_for`, `fulfilled`)
) ENGINE=InnoDB;
