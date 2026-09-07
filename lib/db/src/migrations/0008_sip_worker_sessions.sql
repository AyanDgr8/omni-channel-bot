-- Durable idempotency/session mapping for authenticated FreeSWITCH deliveries.
-- `event_id` and `freeswitch_uuid` are varchar(191) rather than TEXT so they
-- can carry a UNIQUE key under utf8mb4 (191 * 4 bytes fits the 767-byte index
-- prefix limit on older row formats).

CREATE TABLE IF NOT EXISTS `sip_worker_sessions` (
  `id` varchar(64) NOT NULL,
  `event_id` varchar(191) NOT NULL,
  `freeswitch_uuid` varchar(191) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `bot_id` varchar(64) NOT NULL,
  `call_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sip_worker_sessions_event_unique` (`event_id`),
  UNIQUE KEY `sip_worker_sessions_uuid_unique` (`freeswitch_uuid`),
  UNIQUE KEY `sip_worker_sessions_tenant_call_unique` (`tenant_id`, `call_id`),
  KEY `sip_worker_sessions_tenant_bot_idx` (`tenant_id`, `bot_id`),
  CONSTRAINT `sip_worker_sessions_bot_fk`
    FOREIGN KEY (`bot_id`, `tenant_id`) REFERENCES `bots` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `sip_worker_sessions_call_fk`
    FOREIGN KEY (`call_id`) REFERENCES `calls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
