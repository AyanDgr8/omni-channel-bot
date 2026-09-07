import { mysqlTable, varchar, text, int, boolean, timestamp, datetime, json, index, uniqueIndex } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Tenant-owned SIP extension settings. `passwordEncrypted` is AES-256-GCM
 * ciphertext only; plaintext SIP passwords are deliberately not modeled.
 */
export const sipConfigsTable = mysqlTable("sip_configs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  botId: varchar("bot_id", { length: 64 }).notNull(),

  enabled: boolean("enabled").notNull().default(true),
  sipDomain: varchar("sip_domain", { length: 255 }),
  registrarHost: varchar("registrar_host", { length: 255 }).notNull(),
  registrarPort: int("registrar_port").notNull().default(5060),
  transport: varchar("transport", { length: 8 }).notNull().default("udp"),
  extension: varchar("extension", { length: 64 }).notNull(),
  authUsername: varchar("auth_username", { length: 128 }).notNull(),
  /** AES-256-GCM ciphertext. Never use this column for plaintext. */
  passwordEncrypted: text("password_encrypted"),
  displayName: varchar("display_name", { length: 255 }),
  callerIdNumber: varchar("caller_id_number", { length: 32 }),
  outboundProxyHost: varchar("outbound_proxy_host", { length: 255 }),
  outboundProxyPort: int("outbound_proxy_port"),
  registerExpirySeconds: int("register_expiry_seconds").notNull().default(300),
  keepaliveIntervalSeconds: int("keepalive_interval_seconds").notNull().default(30),

  /**
   * MySQL has no array type, so the codec preference list is a JSON array.
   * MySQL also forbids literal DEFAULTs on JSON columns, hence `$defaultFn`.
   */
  codecs: json("codecs").$type<string[]>().notNull().$defaultFn(() => ["PCMU", "PCMA"]),
  dtmfMode: varchar("dtmf_mode", { length: 16 }).notNull().default("rfc2833"),
  srtpMode: varchar("srtp_mode", { length: 16 }).notNull().default("disabled"),
  rtpPortMin: int("rtp_port_min").notNull().default(10000),
  rtpPortMax: int("rtp_port_max").notNull().default(20000),
  ptimeMs: int("ptime_ms").notNull().default(20),

  natTraversal: varchar("nat_traversal", { length: 16 }).notNull().default("none"),
  stunServer: varchar("stun_server", { length: 255 }),
  localBindIp: varchar("local_bind_ip", { length: 64 }),
  externalIp: varchar("external_ip", { length: 64 }),

  maxConcurrentCalls: int("max_concurrent_calls").notNull().default(1),
  /**
   * Exact E.164 numbers, or a prefix with a single trailing `*`.
   * PostgreSQL enforced the shape with a CHECK over `array_to_string`; MySQL
   * cannot express that over a JSON column, so the pattern is enforced by the
   * Zod schema on every write path in routes/sip.ts (see `inboundDid`).
   */
  inboundDids: json("inbound_dids").$type<string[]>().notNull().$defaultFn(() => []),
  answerDelayMs: int("answer_delay_ms").notNull().default(0),
  recordCalls: boolean("record_calls").notNull().default(false),
  outboundEnabled: boolean("outbound_enabled").notNull().default(false),
  outboundPrefix: varchar("outbound_prefix", { length: 32 }),

  /** TLS certificate verification remains enabled unless explicitly overridden. */
  allowSelfSigned: boolean("allow_self_signed").notNull().default(false),
  /** Enables SIP trace collection; callers must still redact credentials. */
  debug: boolean("debug").notNull().default(false),

  registrationState: varchar("registration_state", { length: 32 }).notNull().default("unregistered"),
  lastRegisteredAt: datetime("last_registered_at"),
  lastError: text("last_error"),
  lastErrorAt: datetime("last_error_at"),
  activeCalls: int("active_calls").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  oneConfigPerBot: uniqueIndex("sip_configs_bot_id_unique").on(table.botId),
  tenantBot: uniqueIndex("sip_configs_tenant_bot_idx").on(table.tenantId, table.botId),
}));

/** Rolling, tenant-scoped SIP service log. */
export const sipEventsTable = mysqlTable("sip_events", {
  id: varchar("id", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 64 }).notNull(),
  botId: varchar("bot_id", { length: 64 }).notNull(),
  /**
   * Millisecond precision (fsp 3). MySQL's default TIMESTAMP has *second*
   * precision, which would collapse a burst of events into one instant and
   * make the newest-500 retention ordering arbitrary.
   */
  timestamp: timestamp("timestamp", { fsp: 3 }).notNull().defaultNow(),
  level: varchar("level", { length: 16 }).notNull().default("info"),
  direction: varchar("direction", { length: 16 }),
  methodResponse: varchar("method_response", { length: 64 }),
  summary: text("summary").notNull(),
  rawSnippet: text("raw_snippet"),
}, (table) => ({
  botTimestamp: index("sip_events_bot_timestamp_idx").on(table.botId, table.timestamp),
  tenantBotTimestamp: index("sip_events_tenant_bot_timestamp_idx").on(
    table.tenantId,
    table.botId,
    table.timestamp,
  ),
}));

export const insertSipConfigSchema = createInsertSchema(sipConfigsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertSipConfig = z.infer<typeof insertSipConfigSchema>;
export type SipConfig = typeof sipConfigsTable.$inferSelect;

export const insertSipEventSchema = createInsertSchema(sipEventsTable).omit({
  timestamp: true,
});
export type InsertSipEvent = z.infer<typeof insertSipEventSchema>;
export type SipEvent = typeof sipEventsTable.$inferSelect;
