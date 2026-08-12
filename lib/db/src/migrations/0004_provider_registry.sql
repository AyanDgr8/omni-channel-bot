-- ────────────────────────────────────────────────────────────────────────────
-- 0004_provider_registry.sql
-- Provider Registry: providers, model_catalog, provider_call_log tables +
-- bot engine-config columns (llm_chain_json, stt_map_json, tts_map_json).
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- ────────────────────────────────────────────────────────────────────────────

-- ── providers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "providers" (
  "id"                text PRIMARY KEY,
  "tenant_id"         text,                          -- NULL = platform-pooled
  "kind"              text NOT NULL,                 -- LLM | STT | TTS
  "vendor"            text NOT NULL,
  "display_name"      text NOT NULL,
  "base_url"          text,
  "auth_mode"         text NOT NULL DEFAULT 'bearer',
  "api_key_encrypted" text,
  "config_json"       jsonb,
  "enabled"           boolean NOT NULL DEFAULT true,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now()
);

-- ── model_catalog ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "model_catalog" (
  "id"             text PRIMARY KEY,
  "vendor"         text NOT NULL,
  "kind"           text NOT NULL,
  "model_id"       text NOT NULL,
  "display_name"   text NOT NULL,
  "tier"           text NOT NULL DEFAULT 'standard',
  "context_window" integer,
  "cost_per_unit"  text,
  "deprecated"     boolean NOT NULL DEFAULT false,
  CONSTRAINT "model_catalog_vendor_kind_model_id_key" UNIQUE ("vendor", "kind", "model_id")
);

-- ── provider_call_log ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "provider_call_log" (
  "id"              text PRIMARY KEY,
  "tenant_id"       text NOT NULL,
  "provider_id"     text,
  "call_id"         text,
  "provider_vendor" text NOT NULL,
  "provider_kind"   text NOT NULL,
  "model_id"        text NOT NULL,
  "outcome_status"  text NOT NULL,
  "latency_ms"      integer NOT NULL,
  "input_tokens"    integer,
  "output_tokens"   integer,
  "error_message"   text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);

-- ── bots — engine-config columns ─────────────────────────────────────────────
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "llm_chain_json" jsonb;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "stt_map_json"   jsonb;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "tts_map_json"   jsonb;

-- ── model_catalog seed data ───────────────────────────────────────────────────
-- All rows use ON CONFLICT DO NOTHING so re-running the migration is safe.

INSERT INTO "model_catalog" ("id","vendor","kind","model_id","display_name","tier","context_window","cost_per_unit","deprecated") VALUES

-- ── LLM: OpenAI ──────────────────────────────────────────────────────────────
('mc-openai-gpt4o',     'openai','LLM','gpt-4o',          'GPT-4o',          'premium',  128000, '$2.50/1M tokens in',  false),
('mc-openai-gpt4o-mini','openai','LLM','gpt-4o-mini',     'GPT-4o mini',     'standard', 128000, '$0.15/1M tokens in',  false),
('mc-openai-gpt4t',     'openai','LLM','gpt-4-turbo',     'GPT-4 Turbo',     'premium',  128000, '$10/1M tokens in',    false),
('mc-openai-gpt35t',    'openai','LLM','gpt-3.5-turbo',   'GPT-3.5 Turbo',   'lite',      16385, '$0.50/1M tokens in',  true),
('mc-openai-o1mini',    'openai','LLM','o1-mini',         'o1-mini',         'premium',  128000, '$1.10/1M tokens in',  false),

-- ── LLM: Anthropic ───────────────────────────────────────────────────────────
('mc-ant-sonnet35',  'anthropic','LLM','claude-3-5-sonnet-20241022','Claude 3.5 Sonnet','premium', 200000,'$3/1M tokens in',   false),
('mc-ant-haiku35',   'anthropic','LLM','claude-3-5-haiku-20241022', 'Claude 3.5 Haiku', 'lite',   200000,'$0.80/1M tokens in',false),
('mc-ant-haiku3',    'anthropic','LLM','claude-3-haiku-20240307',   'Claude 3 Haiku',   'lite',   200000,'$0.25/1M tokens in',false),
('mc-ant-opus3',     'anthropic','LLM','claude-3-opus-20240229',    'Claude 3 Opus',    'premium',200000,'$15/1M tokens in',  false),
('mc-ant-sonnet45',  'anthropic','LLM','claude-sonnet-4-5',         'Claude Sonnet 4.5','premium',200000,'$3/1M tokens in',   false),

-- ── LLM: Google Gemini ───────────────────────────────────────────────────────
('mc-gem-15flash',  'google-gemini','LLM','gemini-1.5-flash',   'Gemini 1.5 Flash',   'lite',    1000000,'$0.075/1M tokens in',false),
('mc-gem-15pro',    'google-gemini','LLM','gemini-1.5-pro',     'Gemini 1.5 Pro',     'premium', 2000000,'$1.25/1M tokens in', false),
('mc-gem-20flash',  'google-gemini','LLM','gemini-2.0-flash',   'Gemini 2.0 Flash',   'standard',1000000,'$0.10/1M tokens in', false),
('mc-gem-20pro',    'google-gemini','LLM','gemini-2.0-pro-exp', 'Gemini 2.0 Pro',     'premium', 2000000,'Contact Google',     false),

-- ── LLM: Sarvam ──────────────────────────────────────────────────────────────
('mc-sarv-m',       'sarvam','LLM','sarvam-m',   'Sarvam M',   'standard',32768,'Contact Sarvam',false),
('mc-sarv-2b',      'sarvam','LLM','sarvam-2b',  'Sarvam 2B',  'lite',     8192,'Contact Sarvam',false),

-- ── STT: Deepgram ────────────────────────────────────────────────────────────
('mc-dg-nova2',     'deepgram','STT','nova-2',         'Nova-2',         'standard',NULL,'$0.0043/min',false),
('mc-dg-nova2-gen', 'deepgram','STT','nova-2-general', 'Nova-2 General', 'standard',NULL,'$0.0043/min',false),
('mc-dg-nova2-med', 'deepgram','STT','nova-2-medical', 'Nova-2 Medical', 'premium', NULL,'$0.0059/min',false),
('mc-dg-base',      'deepgram','STT','base',           'Base',           'lite',    NULL,'$0.0025/min',true),

-- ── STT: ElevenLabs ──────────────────────────────────────────────────────────
('mc-el-scribe1',   'elevenlabs','STT','scribe_v1','Scribe v1','standard',NULL,'$0.40/hr',false),

-- ── STT: Google ──────────────────────────────────────────────────────────────
('mc-goog-chirp',   'google','STT','chirp',  'Chirp',  'standard',NULL,'$0.016/min',false),
('mc-goog-chirp2',  'google','STT','chirp_2','Chirp 2','premium', NULL,'$0.016/min',false),

-- ── STT: Sarvam ──────────────────────────────────────────────────────────────
('mc-sarv-saarika1','sarvam','STT','saarika:v1','Saarika v1','standard',NULL,'Contact Sarvam',false),
('mc-sarv-saarika2','sarvam','STT','saarika:v2','Saarika v2','premium', NULL,'Contact Sarvam',false),

-- ── STT: Whisper-compatible ───────────────────────────────────────────────────
('mc-wh-1',         'whisper-compatible','STT','whisper-1',       'Whisper v1',       'standard',NULL,NULL,false),
('mc-wh-largev3',   'whisper-compatible','STT','whisper-large-v3','Whisper Large v3', 'premium', NULL,NULL,false),

-- ── TTS: ElevenLabs ──────────────────────────────────────────────────────────
('mc-el-tts-turbo2','elevenlabs','TTS','eleven_turbo_v2',       'Eleven Turbo v2',       'standard',NULL,'$0.30/1K chars',false),
('mc-el-tts-ml2',   'elevenlabs','TTS','eleven_multilingual_v2','Eleven Multilingual v2','premium', NULL,'$0.30/1K chars',false),
('mc-el-tts-flash', 'elevenlabs','TTS','eleven_flash_v2_5',     'Eleven Flash v2.5',     'lite',    NULL,'$0.18/1K chars',false),

-- ── TTS: Google ──────────────────────────────────────────────────────────────
('mc-goog-wavenet', 'google','TTS','wavenet','WaveNet','standard',NULL,'$0.016/1K chars',false),
('mc-goog-neural2', 'google','TTS','neural2', 'Neural2','premium', NULL,'$0.016/1K chars',false),

-- ── TTS: Deepgram Aura ───────────────────────────────────────────────────────
('mc-dga-asteria',  'deepgram-aura','TTS','aura-asteria-en','Aura Asteria (EN)','standard',NULL,'$0.0135/1K chars',false),
('mc-dga-luna',     'deepgram-aura','TTS','aura-luna-en',   'Aura Luna (EN)',   'standard',NULL,'$0.0135/1K chars',false),
('mc-dga-stella',   'deepgram-aura','TTS','aura-stella-en', 'Aura Stella (EN)', 'standard',NULL,'$0.0135/1K chars',false),
('mc-dga-arcas',    'deepgram-aura','TTS','aura-arcas-en',  'Aura Arcas (EN)',  'standard',NULL,'$0.0135/1K chars',false),
('mc-dga-orion',    'deepgram-aura','TTS','aura-orion-en',  'Aura Orion (EN)',  'standard',NULL,'$0.0135/1K chars',false),

-- ── TTS: Cartesia ────────────────────────────────────────────────────────────
('mc-cart-sonic-en','cartesia','TTS','sonic-english',     'Sonic English',     'standard',NULL,'$0.065/1K chars',false),
('mc-cart-sonic-ml','cartesia','TTS','sonic-multilingual','Sonic Multilingual','premium', NULL,'$0.065/1K chars',false),

-- ── TTS: Sarvam ──────────────────────────────────────────────────────────────
('mc-sarv-bulbul1', 'sarvam','TTS','bulbul:v1','Bulbul v1','standard',NULL,'Contact Sarvam',false),
('mc-sarv-bulbul2', 'sarvam','TTS','bulbul:v2','Bulbul v2','premium', NULL,'Contact Sarvam',false),

-- ── TTS: Azure ───────────────────────────────────────────────────────────────
('mc-az-neural',    'azure','TTS','neural','Azure Neural','standard',NULL,'$0.016/1K chars',false),
('mc-az-hd',        'azure','TTS','hd',    'Azure HD',    'premium', NULL,'$0.030/1K chars',false)

ON CONFLICT ("vendor","kind","model_id") DO NOTHING;
