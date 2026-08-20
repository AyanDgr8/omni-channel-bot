CREATE TABLE `bots` (
	`id` varchar(64) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`email` varchar(255),
	`sip_extension` varchar(64) NOT NULL,
	`sip_domain` varchar(255),
	`whatsapp_number` varchar(32),
	`status` varchar(32) NOT NULL DEFAULT 'OFFLINE',
	`active_calls` int NOT NULL DEFAULT 0,
	`direction` varchar(16) NOT NULL DEFAULT 'inbound',
	`direction_config` json,
	`supported_languages` json NOT NULL,
	`default_greeting_language` varchar(16) NOT NULL DEFAULT 'en',
	`timezone` varchar(64) NOT NULL DEFAULT 'UTC',
	`endpoint_silence_ms` int NOT NULL DEFAULT 1200,
	`backchannel_threshold_ms` int NOT NULL DEFAULT 700,
	`silence_recovery_secs` int NOT NULL DEFAULT 6,
	`tenant_id` varchar(64) NOT NULL,
	`active_persona_id` varchar(64),
	`llm_chain_json` json,
	`stt_map_json` json,
	`tts_map_json` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calls` (
	`id` varchar(64) NOT NULL,
	`bot_id` varchar(64) NOT NULL,
	`direction` varchar(16) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'INITIATING',
	`customer_number` varchar(32),
	`customer_name` varchar(255),
	`started_at` datetime,
	`ended_at` datetime,
	`duration_seconds` int,
	`hangup_reason` varchar(64),
	`sip_code` int,
	`amd_result` varchar(32),
	`language_detected` varchar(16),
	`recording_url` text,
	`summary` text,
	`transfer_target` varchar(64),
	`follow_up_sent` boolean NOT NULL DEFAULT false,
	`connect_outcome` varchar(32),
	`interruption_count` int NOT NULL DEFAULT 0,
	`escalation_count` int NOT NULL DEFAULT 0,
	`language_switches` json,
	`final_disposition` varchar(64),
	`persona_id` varchar(64),
	`composed_prompt` text,
	`tenant_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `persona_config` (
	`id` varchar(64) NOT NULL DEFAULT 'default',
	`name` varchar(255) NOT NULL DEFAULT 'Aria',
	`character` varchar(64) NOT NULL DEFAULT 'professional',
	`formality` real NOT NULL DEFAULT 0.8,
	`verbosity` real NOT NULL DEFAULT 0.5,
	`empathy_level` real NOT NULL DEFAULT 0.7,
	`humor_level` real NOT NULL DEFAULT 0.1,
	`speaking_rate` real NOT NULL DEFAULT 1,
	`pitch` real NOT NULL DEFAULT 0,
	`voice_id` varchar(128),
	`filler_words_enabled` boolean NOT NULL DEFAULT false,
	`greeting_style` varchar(64) NOT NULL DEFAULT 'warm',
	`interrupt_mode` varchar(32) NOT NULL DEFAULT 'HARD_INTERRUPT',
	`tenant_id` varchar(64) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `persona_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversation_config` (
	`id` varchar(64) NOT NULL DEFAULT 'default',
	`answer_delay_ms` int NOT NULL DEFAULT 400,
	`max_silence_ms` int NOT NULL DEFAULT 2000,
	`barge_in_enabled` boolean NOT NULL DEFAULT true,
	`barge_in_threshold` real NOT NULL DEFAULT 0.6,
	`min_speech_ms` int NOT NULL DEFAULT 200,
	`end_of_utterance_ms` int NOT NULL DEFAULT 800,
	`max_turn_duration_sec` int NOT NULL DEFAULT 60,
	`response_timeout_sec` int NOT NULL DEFAULT 5,
	`speaking_rate` real NOT NULL DEFAULT 1,
	`inter_word_pause_ms` int NOT NULL DEFAULT 0,
	`tenant_id` varchar(64) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversation_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `llm_config` (
	`id` varchar(64) NOT NULL DEFAULT 'default',
	`primary` varchar(64) NOT NULL DEFAULT 'openai',
	`fallback_chain` json NOT NULL,
	`timeout_ms` int NOT NULL DEFAULT 3000,
	`max_retries` int NOT NULL DEFAULT 2,
	`circuit_breaker_failure_threshold` int NOT NULL DEFAULT 5,
	`circuit_breaker_recovery_timeout_sec` int NOT NULL DEFAULT 30,
	`tenant_id` varchar(64) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `llm_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` varchar(64) NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`hit_count` int NOT NULL DEFAULT 0,
	`confidence` real NOT NULL DEFAULT 1,
	`tier` varchar(8) NOT NULL DEFAULT 'L3',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_hit_at` datetime,
	`tenant_id` varchar(64) NOT NULL,
	CONSTRAINT `memory_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendar_invites` (
	`id` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`start` datetime NOT NULL,
	`end` datetime NOT NULL,
	`timezone` varchar(64) NOT NULL,
	`attendees` json NOT NULL,
	`location` text,
	`meet_link` text,
	`calendar_event_id` varchar(128),
	`call_id` varchar(64),
	`tenant_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `calendar_invites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_logs` (
	`id` varchar(64) NOT NULL,
	`channel` varchar(32) NOT NULL,
	`recipient` varchar(255) NOT NULL,
	`template_name` varchar(255),
	`message_id` varchar(128),
	`status` varchar(32) NOT NULL DEFAULT 'sent',
	`call_id` varchar(64),
	`tenant_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `message_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flow_configs` (
	`id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`definition` json NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `flow_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_agent_config` (
	`id` varchar(64) NOT NULL DEFAULT 'default',
	`tenant_id` varchar(128) NOT NULL DEFAULT '',
	`client_id` varchar(128) NOT NULL DEFAULT '',
	`client_secret` varchar(512) NOT NULL DEFAULT '',
	`user_email` varchar(255) NOT NULL DEFAULT '',
	`is_enabled` boolean NOT NULL DEFAULT false,
	`vox_tenant_id` varchar(64) NOT NULL DEFAULT 'default',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_agent_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `writing_style_profiles` (
	`id` varchar(64) NOT NULL DEFAULT 'default',
	`greeting` varchar(255) NOT NULL DEFAULT 'Hi,',
	`sign_off` varchar(255) NOT NULL DEFAULT 'Best regards,',
	`tone` varchar(64) NOT NULL DEFAULT 'professional',
	`call_summary_template` text NOT NULL,
	`style_examples` json NOT NULL,
	`learned_patterns` json NOT NULL,
	`last_learned_at` datetime,
	`tenant_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `writing_style_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `personas` (
	`id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`source` varchar(32) NOT NULL DEFAULT 'manual',
	`is_active` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`tenant_id` varchar(64) NOT NULL,
	CONSTRAINT `personas_id` PRIMARY KEY(`id`),
	CONSTRAINT `personas_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `persona_traits` (
	`id` varchar(64) NOT NULL,
	`persona_id` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`traits` json NOT NULL,
	`generated_by_model` varchar(128),
	`tenant_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `persona_traits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`region` varchar(64) NOT NULL DEFAULT 'global',
	`webhook_secret` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` text NOT NULL,
	`role` varchar(32) NOT NULL DEFAULT 'ANALYST',
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `tenant_dids` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`did_e164` varchar(32) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenant_dids_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_dids_did_e164_unique` UNIQUE(`did_e164`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64),
	`action` varchar(32) NOT NULL,
	`entity` varchar(64) NOT NULL,
	`entity_id` varchar(64),
	`before_json` json,
	`after_json` json,
	`ip` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64),
	`kind` varchar(16) NOT NULL,
	`vendor` varchar(64) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`base_url` text,
	`auth_mode` varchar(16) NOT NULL DEFAULT 'bearer',
	`api_key_encrypted` text,
	`config_json` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `providers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_catalog` (
	`id` varchar(64) NOT NULL,
	`vendor` varchar(64) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`model_id` varchar(128) NOT NULL,
	`display_name` varchar(255) NOT NULL,
	`tier` varchar(32) NOT NULL DEFAULT 'standard',
	`context_window` int,
	`cost_per_unit` text,
	`deprecated` boolean NOT NULL DEFAULT false,
	CONSTRAINT `model_catalog_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_catalog_vendor_kind_model_id_key` UNIQUE(`vendor`,`kind`,`model_id`)
);
--> statement-breakpoint
CREATE TABLE `provider_call_log` (
	`id` varchar(64) NOT NULL,
	`tenant_id` varchar(64) NOT NULL,
	`provider_id` varchar(64),
	`call_id` varchar(64),
	`provider_vendor` varchar(64) NOT NULL,
	`provider_kind` varchar(16) NOT NULL,
	`model_id` varchar(128) NOT NULL,
	`outcome_status` varchar(32) NOT NULL,
	`latency_ms` int NOT NULL,
	`input_tokens` int,
	`output_tokens` int,
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `provider_call_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `persona_traits` ADD CONSTRAINT `persona_traits_persona_id_personas_id_fk` FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_dids` ADD CONSTRAINT `tenant_dids_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;