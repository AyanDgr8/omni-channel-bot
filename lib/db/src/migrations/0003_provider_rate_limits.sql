-- Adds `provider_call_log.rate_limit_json`.
--
-- This previously used `ADD COLUMN IF NOT EXISTS`, which is MariaDB syntax that
-- MySQL rejects with a syntax error, so the migration could never apply to a
-- fresh MySQL database. The information_schema guard below is the MySQL way to
-- express the same intent, and keeps the migration safe to re-run.

SET @rate_limit_json_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_call_log'
    AND COLUMN_NAME = 'rate_limit_json'
);
--> statement-breakpoint
SET @add_rate_limit_json := IF(
  @rate_limit_json_exists = 0,
  'ALTER TABLE `provider_call_log` ADD COLUMN `rate_limit_json` text NULL AFTER `output_tokens`',
  'DO 0'
);
--> statement-breakpoint
PREPARE add_rate_limit_json FROM @add_rate_limit_json;
--> statement-breakpoint
EXECUTE add_rate_limit_json;
--> statement-breakpoint
DEALLOCATE PREPARE add_rate_limit_json;
