-- ────────────────────────────────────────────────────────────────────────────
-- 0007_sip_telephony.sql  (MySQL)
--
-- SIP extension transport configuration and the bounded service event log.
-- SIP secrets live exclusively in `password_encrypted` (AES-256-GCM).
--
-- Notes on the PostgreSQL → MySQL port:
--   * `text[]` has no MySQL equivalent, so `codecs` and `inbound_dids` are JSON
--     arrays. The codec subset check is expressed with JSON_CONTAINS.
--   * The upstream regex CHECK over `inbound_dids` cannot be expressed against
--     a JSON array in MySQL. That pattern is enforced by the Zod `inboundDid`
--     schema on every write path in artifacts/api-server/src/routes/sip.ts.
--   * The composite foreign keys need a unique key on `bots (id, tenant_id)`,
--     added below, exactly as upstream does.
--   * `sip_events.timestamp` is TIMESTAMP(3). MySQL's default second precision
--     would collapse a burst of events into one instant, making the bounded
--     newest-500 retention delete pick arbitrary rows.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE `bots`
  ADD COLUMN `telephony_type` varchar(16) NOT NULL DEFAULT 'webrtc',
  ADD CONSTRAINT `bots_telephony_type_check` CHECK (`telephony_type` IN ('webrtc', 'sip')),
  ADD UNIQUE KEY `bots_id_tenant_id_unique` (`id`, `tenant_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sip_configs` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `bot_id` varchar(64) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `sip_domain` varchar(255),
  `registrar_host` varchar(255) NOT NULL,
  `registrar_port` int NOT NULL DEFAULT 5060,
  `transport` varchar(8) NOT NULL DEFAULT 'udp',
  `extension` varchar(64) NOT NULL,
  `auth_username` varchar(128) NOT NULL,
  `password_encrypted` text,
  `display_name` varchar(255),
  `caller_id_number` varchar(32),
  `outbound_proxy_host` varchar(255),
  `outbound_proxy_port` int,
  `register_expiry_seconds` int NOT NULL DEFAULT 300,
  `keepalive_interval_seconds` int NOT NULL DEFAULT 30,
  `codecs` json NOT NULL DEFAULT (CAST('["PCMU","PCMA"]' AS JSON)),
  `dtmf_mode` varchar(16) NOT NULL DEFAULT 'rfc2833',
  `srtp_mode` varchar(16) NOT NULL DEFAULT 'disabled',
  `rtp_port_min` int NOT NULL DEFAULT 10000,
  `rtp_port_max` int NOT NULL DEFAULT 20000,
  `ptime_ms` int NOT NULL DEFAULT 20,
  `nat_traversal` varchar(16) NOT NULL DEFAULT 'none',
  `stun_server` varchar(255),
  `local_bind_ip` varchar(64),
  `external_ip` varchar(64),
  `max_concurrent_calls` int NOT NULL DEFAULT 1,
  `inbound_dids` json NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `answer_delay_ms` int NOT NULL DEFAULT 0,
  `record_calls` boolean NOT NULL DEFAULT false,
  `outbound_enabled` boolean NOT NULL DEFAULT false,
  `outbound_prefix` varchar(32),
  `allow_self_signed` boolean NOT NULL DEFAULT false,
  `debug` boolean NOT NULL DEFAULT false,
  `registration_state` varchar(32) NOT NULL DEFAULT 'unregistered',
  `last_registered_at` datetime NULL,
  `last_error` text,
  `last_error_at` datetime NULL,
  `active_calls` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sip_configs_bot_id_unique` (`bot_id`),
  UNIQUE KEY `sip_configs_tenant_bot_idx` (`tenant_id`, `bot_id`),
  CONSTRAINT `sip_configs_tenant_bot_fk`
    FOREIGN KEY (`bot_id`, `tenant_id`) REFERENCES `bots` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `sip_configs_transport_check` CHECK (`transport` IN ('udp', 'tcp', 'tls', 'wss')),
  CONSTRAINT `sip_configs_dtmf_mode_check` CHECK (`dtmf_mode` IN ('rfc2833', 'sip_info', 'inband')),
  CONSTRAINT `sip_configs_srtp_mode_check` CHECK (`srtp_mode` IN ('disabled', 'optional', 'required')),
  CONSTRAINT `sip_configs_nat_traversal_check` CHECK (`nat_traversal` IN ('none', 'stun', 'force_rport')),
  CONSTRAINT `sip_configs_registration_state_check`
    CHECK (`registration_state` IN ('unregistered', 'registering', 'registered', 'failed')),
  CONSTRAINT `sip_configs_port_check`
    CHECK (`registrar_port` BETWEEN 1 AND 65535
      AND (`outbound_proxy_port` IS NULL OR `outbound_proxy_port` BETWEEN 1 AND 65535)),
  CONSTRAINT `sip_configs_timing_check`
    CHECK (`register_expiry_seconds` BETWEEN 60 AND 86400 AND `keepalive_interval_seconds` >= 1
      AND `ptime_ms` >= 1 AND `max_concurrent_calls` >= 1 AND `answer_delay_ms` >= 0),
  CONSTRAINT `sip_configs_registrar_host_check`
    CHECK (CHAR_LENGTH(TRIM(`registrar_host`)) BETWEEN 1 AND 253),
  CONSTRAINT `sip_configs_rtp_range_check`
    CHECK (`rtp_port_min` BETWEEN 1 AND 65535 AND `rtp_port_max` BETWEEN 1 AND 65535
      AND `rtp_port_min` % 2 = 0 AND `rtp_port_max` % 2 = 0
      AND `rtp_port_max` - `rtp_port_min` >= 100),
  CONSTRAINT `sip_configs_codecs_check`
    CHECK (JSON_LENGTH(`codecs`) > 0
      AND JSON_CONTAINS(CAST('["PCMU","PCMA","G722","OPUS"]' AS JSON), `codecs`))
) ENGINE=InnoDB;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sip_events` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `bot_id` varchar(64) NOT NULL,
  `timestamp` timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  `level` varchar(16) NOT NULL DEFAULT 'info',
  `direction` varchar(16),
  `method_response` varchar(64),
  `summary` text NOT NULL,
  `raw_snippet` text,
  PRIMARY KEY (`id`),
  KEY `sip_events_bot_timestamp_idx` (`bot_id`, `timestamp` DESC),
  KEY `sip_events_tenant_bot_timestamp_idx` (`tenant_id`, `bot_id`, `timestamp` DESC),
  CONSTRAINT `sip_events_tenant_bot_fk`
    FOREIGN KEY (`bot_id`, `tenant_id`) REFERENCES `bots` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `sip_events_level_check` CHECK (`level` IN ('debug', 'info', 'warn', 'error')),
  CONSTRAINT `sip_events_direction_check`
    CHECK (`direction` IS NULL OR `direction` IN ('inbound', 'outbound'))
) ENGINE=InnoDB;
