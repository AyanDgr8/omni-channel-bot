/**
 * Engine / Media-Plane Interface
 *
 * GET /v1/engine/session-config/:callId
 *
 * Returns the fully resolved STT/LLM/TTS provider + model + voice settings
 * for a call, keyed by the call's detected language and the assigned bot's
 * engine maps (llm_chain_json, stt_map_json, tts_map_json).
 *
 * Consumed by the MCSSE media layer at call setup (FR-TECH-05/06).
 *
 * ---
 * openapi: 3.1.0
 * paths:
 *   /v1/engine/session-config/{callId}:
 *     get:
 *       summary: Resolved engine configuration for a live call
 *       description: |
 *         Returns the fully resolved provider + model settings the media plane
 *         should use for LLM inference, speech-to-text, and text-to-speech for
 *         the given call. Resolution order per modality:
 *         1. Bot-level map (llm_chain_json / stt_map_json / tts_map_json)
 *         2. Tenant-level enabled providers (ordered by creation time)
 *         3. Platform-pooled NULL-tenant providers
 *       parameters:
 *         - in: path
 *           name: callId
 *           required: true
 *           schema: { type: string }
 *       responses:
 *         "200":
 *           description: Resolved engine config
 *           content:
 *             application/json:
 *               schema:
 *                 type: object
 *                 properties:
 *                   callId:   { type: string }
 *                   botId:    { type: string }
 *                   language: { type: string, description: "ISO 639-1 code; falls back to bot.defaultGreetingLanguage" }
 *                   llm:
 *                     type: object
 *                     properties:
 *                       chain:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             providerId:  { type: string }
 *                             vendor:      { type: string }
 *                             displayName: { type: string }
 *                             modelId:     { type: string }
 *                             params:      { type: object }
 *                   stt:
 *                     nullable: true
 *                     type: object
 *                     properties:
 *                       providerId:  { type: string }
 *                       vendor:      { type: string }
 *                       displayName: { type: string }
 *                       modelId:     { type: string }
 *                   tts:
 *                     nullable: true
 *                     type: object
 *                     properties:
 *                       providerId:  { type: string }
 *                       vendor:      { type: string }
 *                       displayName: { type: string }
 *                       modelId:     { type: string }
 *                       voice:       { type: string, nullable: true }
 *         "404":
 *           description: Call not found
 * ---
 */
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, callsTable, botsTable } from "@workspace/db";
import { providerRegistry } from "../lib/provider-registry.js";
import type { LlmChainEntry } from "../lib/provider-registry.js";

const router: IRouter = Router();

router.get("/v1/engine/session-config/:callId", async (req, res): Promise<void> => {
  const callId = req.params.callId as string;

  // 1. Load the call (tenant-scoped)
  const [call] = await db
    .select()
    .from(callsTable)
    .where(and(eq(callsTable.id, callId), eq(callsTable.tenantId, req.tenantId!)));
  if (!call) { res.status(404).json({ error: "Call not found" }); return; }

  // 2. Load the bot
  const [bot] = await db
    .select()
    .from(botsTable)
    .where(and(eq(botsTable.id, call.botId), eq(botsTable.tenantId, req.tenantId!)));
  if (!bot) { res.status(404).json({ error: "Bot not found for this call" }); return; }

  // 3. Resolve language (detected > bot default)
  const language = call.languageDetected ?? bot.defaultGreetingLanguage ?? "en";

  // 4. Resolve LLM chain
  const rawChain = await providerRegistry.buildLlmChain(req.tenantId!, call.botId);
  const llmChain = rawChain.map((entry) => ({
    providerId: entry.provider.id.startsWith("legacy-") ? null : entry.provider.id,
    vendor: entry.provider.vendor,
    displayName: entry.provider.displayName,
    modelId: entry.modelId,
    params: {
      temperature: entry.params.temperature,
      maxTokens: entry.params.maxTokens,
    },
  }));

  // 5. Resolve STT
  const stt = await providerRegistry.resolveStt(req.tenantId!, language, call.botId);

  // 6. Resolve TTS
  const tts = await providerRegistry.resolveTts(req.tenantId!, language, call.botId);

  res.json({
    callId: call.id,
    botId: call.botId,
    language,
    llm: { chain: llmChain },
    stt,
    tts,
  });
});

export default router;
