import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { botsTable, callsTable, db } from "@workspace/db";

function bridge(callId: string) {
  const mediaBridgeUrl = process.env.MEDIA_BRIDGE_URL;
  const secret = process.env.MEDIA_BRIDGE_TOKEN_SECRET;
  if (!mediaBridgeUrl || !secret) throw new Error("Media bridge is not configured");
  return {
    mediaBridgeUrl,
    mediaSessionToken: createHmac("sha256", secret).update(callId).digest("hex"),
  };
}

export async function buildMediaSession(tenantId: string, botId: string, callId: string) {
  const [[bot], [call]] = await Promise.all([
    db.select().from(botsTable).where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, tenantId))).limit(1),
    db.select().from(callsTable).where(and(eq(callsTable.id, callId), eq(callsTable.botId, botId), eq(callsTable.tenantId, tenantId))).limit(1),
  ]);
  if (!bot || !call) throw new Error("Call session not found");
  const sessionConfig = {
    callId,
    botId: bot.id,
    tenantId: bot.tenantId,
    direction: call.direction,
    directionConfig: bot.directionConfig,
    supportedLanguages: bot.supportedLanguages,
    defaultGreetingLanguage: bot.defaultGreetingLanguage,
    timezone: bot.timezone,
    llmChainJson: bot.llmChainJson,
    sttMapJson: bot.sttMapJson,
    ttsMapJson: bot.ttsMapJson,
    activePersonaId: bot.activePersonaId,
    persona: { id: call.personaId, name: call.personaName, version: call.personaVersion, composedPrompt: call.composedPrompt },
    disclosureText: call.disclosureText,
    recordingConsentStatus: call.recordingConsentStatus,
  };
  return { ...bridge(callId), sessionConfig };
}