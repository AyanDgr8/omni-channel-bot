-- Baseline snapshot of all tables that existed before migration tracking was introduced.
-- Uses IF NOT EXISTS throughout so it is safe to run against an already-provisioned database.

CREATE TABLE IF NOT EXISTS "bots" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"sip_extension" text NOT NULL,
	"sip_domain" text,
	"whatsapp_number" text,
	"status" text DEFAULT 'OFFLINE' NOT NULL,
	"active_calls" integer DEFAULT 0 NOT NULL,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"direction_config" jsonb,
	"supported_languages" text[] DEFAULT '{"en"}' NOT NULL,
	"default_greeting_language" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"endpoint_silence_ms" integer DEFAULT 1200 NOT NULL,
	"backchannel_threshold_ms" integer DEFAULT 700 NOT NULL,
	"silence_recovery_secs" integer DEFAULT 6 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'INITIATING' NOT NULL,
	"customer_number" text,
	"customer_name" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"hangup_reason" text,
	"sip_code" integer,
	"amd_result" text,
	"language_detected" text,
	"recording_url" text,
	"summary" text,
	"transfer_target" text,
	"follow_up_sent" boolean DEFAULT false NOT NULL,
	"connect_outcome" text,
	"interruption_count" integer DEFAULT 0 NOT NULL,
	"escalation_count" integer DEFAULT 0 NOT NULL,
	"language_switches" jsonb,
	"final_disposition" text,
	"persona_id" text,
	"composed_prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persona_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"name" text DEFAULT 'Aria' NOT NULL,
	"character" text DEFAULT 'professional' NOT NULL,
	"formality" real DEFAULT 0.8 NOT NULL,
	"verbosity" real DEFAULT 0.5 NOT NULL,
	"empathy_level" real DEFAULT 0.7 NOT NULL,
	"humor_level" real DEFAULT 0.1 NOT NULL,
	"speaking_rate" real DEFAULT 1 NOT NULL,
	"pitch" real DEFAULT 0 NOT NULL,
	"voice_id" text,
	"filler_words_enabled" boolean DEFAULT false NOT NULL,
	"greeting_style" text DEFAULT 'warm' NOT NULL,
	"interrupt_mode" text DEFAULT 'HARD_INTERRUPT' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"answer_delay_ms" integer DEFAULT 400 NOT NULL,
	"max_silence_ms" integer DEFAULT 2000 NOT NULL,
	"barge_in_enabled" boolean DEFAULT true NOT NULL,
	"barge_in_threshold" real DEFAULT 0.6 NOT NULL,
	"min_speech_ms" integer DEFAULT 200 NOT NULL,
	"end_of_utterance_ms" integer DEFAULT 800 NOT NULL,
	"max_turn_duration_sec" integer DEFAULT 60 NOT NULL,
	"response_timeout_sec" integer DEFAULT 5 NOT NULL,
	"speaking_rate" real DEFAULT 1 NOT NULL,
	"inter_word_pause_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"primary" text DEFAULT 'openai' NOT NULL,
	"fallback_chain" text[] DEFAULT '{"anthropic","gemini","ollama"}' NOT NULL,
	"timeout_ms" integer DEFAULT 3000 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"circuit_breaker_failure_threshold" integer DEFAULT 5 NOT NULL,
	"circuit_breaker_recovery_timeout_sec" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"tier" text DEFAULT 'L3' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_hit_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"attendees" text[] DEFAULT '{}' NOT NULL,
	"location" text,
	"meet_link" text,
	"calendar_event_id" text,
	"call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"template_name" text,
	"message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flow_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_agent_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"tenant_id" text DEFAULT '' NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"client_secret" text DEFAULT '' NOT NULL,
	"user_email" text DEFAULT '' NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "writing_style_profiles" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"greeting" text DEFAULT 'Hi,' NOT NULL,
	"sign_off" text DEFAULT 'Best regards,' NOT NULL,
	"tone" text DEFAULT 'professional' NOT NULL,
	"call_summary_template" text DEFAULT 'Hi {{customerName}},

Thank you for speaking with us today. Here is a summary of our call:

{{summary}}

{{signOff}}' NOT NULL,
	"style_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"learned_patterns" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_learned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "personas_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persona_traits" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"traits" jsonb NOT NULL,
	"generated_by_model" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "persona_traits"
    ADD CONSTRAINT "persona_traits_persona_id_personas_id_fk"
    FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
