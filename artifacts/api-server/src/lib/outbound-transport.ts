import { and, eq, sql } from "drizzle-orm";
import { botsTable, db, sipConfigsTable, sipWorkerSessionsTable } from "@workspace/db";
import { originateFreeSwitchWithSession } from "./freeswitch-worker.js";
import { buildMediaSession } from "./media-session.js";

async function submitSip(config: typeof sipConfigsTable.$inferSelect, botId: string, tenantId: string, callId: string, to: string) {
  const session = await buildMediaSession(tenantId, botId, callId);
  await db.insert(sipWorkerSessionsTable).values({
    id: crypto.randomUUID(), eventId: `outbound:${callId}`, freeswitchUuid: callId, tenantId, botId, callId,
  });
  try {
    const result = await originateFreeSwitchWithSession(config, callId, to, session);
    await db.update(sipConfigsTable).set({ activeCalls: sql`${sipConfigsTable.activeCalls} + 1`, updatedAt: new Date() })
      .where(and(eq(sipConfigsTable.id, config.id), eq(sipConfigsTable.tenantId, tenantId)));
    return result;
  } catch (error) {
    await db.delete(sipWorkerSessionsTable).where(and(eq(sipWorkerSessionsTable.callId, callId), eq(sipWorkerSessionsTable.tenantId, tenantId)));
    throw error;
  }
}

export async function submitSipTestCall(botId: string, tenantId: string, callId: string, to: string) {
  const [config] = await db.select().from(sipConfigsTable).where(and(eq(sipConfigsTable.botId, botId), eq(sipConfigsTable.tenantId, tenantId))).limit(1);
  if (!config?.enabled || !config.passwordEncrypted || config.registrationState !== "registered") {
    throw new Error("SIP test call requires an enabled, registered configuration");
  }
  return submitSip(config, botId, tenantId, callId, to);
}

/** Submit a persisted outbound call to the bot's selected transport. */
export async function submitOutboundCall(botId: string, tenantId: string, callId: string, to: string): Promise<"webrtc" | "sip"> {
  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, tenantId))).limit(1);
  if (!bot) throw new Error("Bot not found");
  if (bot.telephonyType !== "sip") return "webrtc";
  const [config] = await db.select().from(sipConfigsTable).where(and(eq(sipConfigsTable.botId, botId), eq(sipConfigsTable.tenantId, tenantId))).limit(1);
  if (!config?.enabled || !config.outboundEnabled || !config.passwordEncrypted || config.registrationState !== "registered") {
    throw new Error("SIP bot requires an enabled, registered configuration with outbound calling enabled");
  }
  await submitSip(config, botId, tenantId, callId, to);
  return "sip";
}