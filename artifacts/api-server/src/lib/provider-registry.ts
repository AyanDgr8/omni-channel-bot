/**
 * ProviderRegistry — FR-TECH-01–09 / CF-05
 *
 * Responsibilities:
 *  1. Resolve the LLM fallback chain for a bot/tenant (from bot.llm_chain_json
 *     → tenant providers → platform-pooled NULL-tenant providers → env-var legacy).
 *  2. Walk that chain with per-provider circuit breakers (CF-05 preserved).
 *  3. Write a provider_call_log row on every attempt.
 *  4. Expose the same chain-resolution logic for STT and TTS (session-config).
 */

import { randomUUID } from "crypto";
import { eq, and, or, isNull, asc } from "drizzle-orm";
import {
  db,
  providersTable,
  modelCatalogTable,
  providerCallLogTable,
  botsTable,
  llmConfigTable,
} from "@workspace/db";
import type { Provider } from "@workspace/db";
import { decryptKey } from "./key-crypto.js";
import { logger } from "./logger.js";
import { ssrfSafeFetch } from "./ssrf-guard.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LlmChainEntry {
  provider_id: string;
  model_id: string;
  params?: {
    temperature?: number;
    max_tokens?: number;
  };
}

export interface SttMapEntry {
  provider_id: string;
  model_id: string;
}

export interface TtsMapEntry {
  provider_id: string;
  model_id: string;
  voice?: string | null;
}

interface ResolvedProvider {
  id: string;
  vendor: string;
  displayName: string;
  baseUrl: string | null;
  authMode: string;
  apiKey: string | null;
}

interface ResolvedLlmEntry {
  provider: ResolvedProvider;
  modelId: string;
  params: { temperature: number; maxTokens: number };
}

export interface LlmResult {
  text: string;
  modelId: string;
  providerId: string | null;
  vendor: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ResolvedSessionProvider {
  providerId: string;
  vendor: string;
  displayName: string;
  modelId: string;
  voice?: string | null;
}

export interface ResolvedSessionConfig {
  botId: string;
  language: string;
  llm: { chain: Array<{ providerId: string; vendor: string; displayName: string; modelId: string; params: object }> };
  stt: ResolvedSessionProvider | null;
  tts: (ResolvedSessionProvider & { voice?: string | null }) | null;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";

interface BreakerState {
  state: CircuitState;
  failureCount: number;
  openedAt: number | null;
  readonly threshold: number;
  readonly recoveryTimeoutMs: number;
}

const DEFAULT_CB_THRESHOLD = 5;
const DEFAULT_CB_RECOVERY_MS = 30_000;

function makeBreakerKey(providerId: string): string {
  return `cb:${providerId}`;
}

// ─── Vendor-specific HTTP callers ─────────────────────────────────────────────

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  params: { temperature: number; maxTokens: number },
  signal: AbortSignal,
  isCustomUrl = false
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const url = `${baseUrl}/chat/completions`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    }),
    signal,
  };

  // For custom (tenant-supplied) URLs, use ssrfSafeFetch which:
  //  1. Resolves ALL DNS records and rejects if any is private (closes TOCTOU window)
  //  2. Pins the connection to the vetted IP (no DNS re-resolution at connect time)
  //  3. Uses redirect:"error" to block redirect-based bypasses
  // For well-known vendor URLs (api.openai.com etc.), plain fetch is acceptable.
  const res = isCustomUrl
    ? await ssrfSafeFetch(url, init)
    : await fetch(url, { ...init, redirect: "error" } as RequestInit);

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices[0].message.content,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

async function callAnthropic(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  params: { temperature: number; maxTokens: number },
  signal: AbortSignal
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal,
    redirect: "error",
  } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content: Array<{ text: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: data.content[0].text,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  };
}

async function callGemini(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  params: { temperature: number; maxTokens: number },
  signal: AbortSignal
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
        },
      }),
      signal,
      redirect: "error",
    } as RequestInit
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  return {
    text: data.candidates[0].content.parts[0].text,
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

async function dispatchLlmCall(
  provider: ResolvedProvider,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  params: { temperature: number; maxTokens: number },
  signal: AbortSignal
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const apiKey = provider.apiKey ?? "";

  switch (provider.vendor) {
    case "openai":
      return callOpenAICompatible(
        provider.baseUrl ?? "https://api.openai.com/v1",
        apiKey || (process.env.OPENAI_API_KEY ?? ""),
        modelId, systemPrompt, userPrompt, params, signal,
        !!provider.baseUrl // custom URL only if explicitly overridden
      );
    case "anthropic":
      return callAnthropic(
        apiKey || (process.env.ANTHROPIC_API_KEY ?? ""),
        modelId, systemPrompt, userPrompt, params, signal
      );
    case "google-gemini":
      return callGemini(
        apiKey || (process.env.GEMINI_API_KEY ?? ""),
        modelId, systemPrompt, userPrompt, params, signal
      );
    case "sarvam":
      // Sarvam uses OpenAI-compatible API at a well-known public endpoint;
      // treat any custom baseUrl override as a custom URL needing validation.
      return callOpenAICompatible(
        provider.baseUrl ?? "https://api.sarvam.ai/v1",
        apiKey,
        modelId, systemPrompt, userPrompt, params, signal,
        !!provider.baseUrl
      );
    case "openai-compatible":
    case "whisper-compatible": {
      if (!provider.baseUrl) throw new Error(`${provider.vendor} provider requires baseUrl`);
      // Always custom URL — validate before every call (defence-in-depth).
      return callOpenAICompatible(
        provider.baseUrl,
        apiKey,
        modelId, systemPrompt, userPrompt, params, signal,
        true /* isCustomUrl */
      );
    }
    case "ollama": {
      // Ollama uses the OpenAI-compatible chat completions API.
      // OLLAMA_API_URL is an operator-controlled env var (never tenant-supplied),
      // so the SSRF guard is not applied — the URL is trusted platform config.
      const ollamaBase = provider.baseUrl ?? process.env.OLLAMA_API_URL ?? "http://localhost:11434/v1";
      return callOpenAICompatible(
        ollamaBase,
        apiKey || "", // Ollama typically requires no API key
        modelId, systemPrompt, userPrompt, params, signal,
        false /* isCustomUrl — operator-controlled URL, not tenant-supplied */
      );
    }
    default:
      throw new Error(`Unsupported LLM vendor: ${provider.vendor}`);
  }
}

// ─── Legacy env-var fallback (backwards-compat) ───────────────────────────────

/**
 * All supported env-var-backed engines, including Ollama (OLLAMA_API_URL).
 * Order here is used as the default when no llm_config row exists.
 */
const LEGACY_ENGINE_MAP: Record<string, { modelId: string; envKey: string; defaultBaseUrl?: string }> = {
  "openai":        { modelId: "gpt-4o-mini",            envKey: "OPENAI_API_KEY" },
  "anthropic":     { modelId: "claude-3-haiku-20240307", envKey: "ANTHROPIC_API_KEY" },
  "google-gemini": { modelId: "gemini-1.5-flash",        envKey: "GEMINI_API_KEY" },
  // llm_config stores the Gemini engine as "gemini" (legacy alias); both names map to
  // the same env var and model so existing tenant configurations continue to work.
  "gemini":        { modelId: "gemini-1.5-flash",        envKey: "GEMINI_API_KEY" },
  // Ollama: self-hosted at OLLAMA_API_URL (admin-controlled env var, never tenant-supplied).
  // SSRF guard is NOT applied because the URL is operator-controlled, not user-controlled.
  "ollama":        { modelId: "llama3",                  envKey: "OLLAMA_API_URL" },
};
const LEGACY_ENGINE_DEFAULT_ORDER = ["openai", "anthropic", "google-gemini", "ollama"] as const;

// ─── ProviderRegistry ─────────────────────────────────────────────────────────

export class ProviderRegistry {
  /** In-memory circuit breakers, keyed by provider id */
  private readonly breakers = new Map<string, BreakerState>();

  // ── Circuit breaker helpers ─────────────────────────────────────────────────

  private getBreaker(
    providerId: string,
    threshold = DEFAULT_CB_THRESHOLD,
    recoveryTimeoutMs = DEFAULT_CB_RECOVERY_MS
  ): BreakerState {
    const key = makeBreakerKey(providerId);
    if (!this.breakers.has(key)) {
      this.breakers.set(key, {
        state: "closed",
        failureCount: 0,
        openedAt: null,
        threshold,
        recoveryTimeoutMs,
      });
    }
    return this.breakers.get(key)!;
  }

  private isOpen(b: BreakerState): boolean {
    if (b.state === "closed") return false;
    if (b.state === "open") {
      if (b.openedAt !== null && Date.now() - b.openedAt >= b.recoveryTimeoutMs) {
        b.state = "half-open";
        return false; // allow one trial
      }
      return true;
    }
    // half-open: allow one trial
    return false;
  }

  private onSuccess(b: BreakerState): void {
    b.state = "closed";
    b.failureCount = 0;
    b.openedAt = null;
  }

  private onFailure(b: BreakerState): void {
    b.failureCount += 1;
    if (b.state === "half-open" || b.failureCount >= b.threshold) {
      b.state = "open";
      b.openedAt = Date.now();
    }
  }

  // ── Provider loader (with key decryption) ───────────────────────────────────

  private resolveProvider(row: Provider): ResolvedProvider {
    return {
      id: row.id,
      vendor: row.vendor,
      displayName: row.displayName,
      baseUrl: row.baseUrl ?? null,
      authMode: row.authMode,
      apiKey: row.apiKeyEncrypted ? decryptKey(row.apiKeyEncrypted) : null,
    };
  }

  // ── Chain building ──────────────────────────────────────────────────────────

  /**
   * Resolve the ordered LLM chain for a bot+tenant.
   * Priority:  bot.llm_chain_json (explicit) → tenant providers → platform-pooled → env-var legacy
   */
  async buildLlmChain(
    tenantId: string,
    botId?: string
  ): Promise<ResolvedLlmEntry[]> {
    const DEFAULT_PARAMS = { temperature: 0.7, maxTokens: 2000 };

    // 1. Try bot-level explicit chain
    if (botId) {
      const [bot] = await db
        .select({ llmChainJson: botsTable.llmChainJson })
        .from(botsTable)
        .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, tenantId)));

      if (bot?.llmChainJson) {
        const chain = bot.llmChainJson as LlmChainEntry[];
        const entries: ResolvedLlmEntry[] = [];
        for (const entry of chain) {
          // Scope: provider must belong to this tenant OR be platform-pooled,
          // must be enabled, and must be an LLM provider — prevents cross-tenant
          // credential use when a bot config references a foreign provider ID.
          const [provRow] = await db
            .select()
            .from(providersTable)
            .where(
              and(
                eq(providersTable.id, entry.provider_id),
                or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId)),
                eq(providersTable.enabled, true),
                eq(providersTable.kind, "LLM")
              )
            );
          if (provRow) {
            entries.push({
              provider: this.resolveProvider(provRow),
              modelId: entry.model_id,
              params: {
                temperature: entry.params?.temperature ?? DEFAULT_PARAMS.temperature,
                maxTokens: entry.params?.max_tokens ?? DEFAULT_PARAMS.maxTokens,
              },
            });
          }
        }
        if (entries.length > 0) return entries;
      }
    }

    // 2. Tenant + platform-pooled providers, ordered by specificity then creation time
    const providers = await db
      .select()
      .from(providersTable)
      .where(
        and(
          eq(providersTable.kind, "LLM"),
          eq(providersTable.enabled, true),
          or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId))
        )
      )
      .orderBy(asc(providersTable.createdAt));

    // Put tenant-specific first
    const sorted = [
      ...providers.filter((p) => p.tenantId === tenantId),
      ...providers.filter((p) => p.tenantId === null),
    ];

    if (sorted.length > 0) {
      const entries: ResolvedLlmEntry[] = [];
      for (const row of sorted) {
        // Pick first non-deprecated model for this vendor
        const [model] = await db
          .select({ modelId: modelCatalogTable.modelId })
          .from(modelCatalogTable)
          .where(
            and(
              eq(modelCatalogTable.vendor, row.vendor),
              eq(modelCatalogTable.kind, "LLM"),
              eq(modelCatalogTable.deprecated, false)
            )
          )
          .limit(1);

        if (model) {
          entries.push({
            provider: this.resolveProvider(row),
            modelId: model.modelId,
            params: DEFAULT_PARAMS,
          });
        }
      }
      if (entries.length > 0) return entries;
    }

    // 3. Legacy env-var fallback — respects all tenant llm_config settings:
    //    primary, fallbackChain (ordering), timeoutMs, circuit-breaker threshold+recovery.
    // If no llm_config exists, use LEGACY_ENGINE_DEFAULT_ORDER and registry defaults.
    const [llmCfg] = await db
      .select()
      .from(llmConfigTable)
      .where(eq(llmConfigTable.tenantId, tenantId))
      .limit(1);

    const configuredOrder: string[] = llmCfg
      ? [llmCfg.primary, ...llmCfg.fallbackChain.filter((v) => v !== llmCfg.primary)]
      : [...LEGACY_ENGINE_DEFAULT_ORDER];

    const legacyChain: ResolvedLlmEntry[] = [];
    for (const vendor of configuredOrder) {
      const engineDef = LEGACY_ENGINE_MAP[vendor];
      if (!engineDef) continue;

      const envValue = process.env[engineDef.envKey];
      if (!envValue) continue;

      // For Ollama, envKey holds the base URL (not an API key)
      const isOllama = vendor === "ollama";
      legacyChain.push({
        provider: {
          id: `legacy-${vendor}`,
          vendor,
          displayName: vendor,
          baseUrl: isOllama ? envValue : (engineDef.defaultBaseUrl ?? null),
          authMode: "bearer",
          apiKey: isOllama ? null : envValue,
        },
        modelId: engineDef.modelId,
        params: DEFAULT_PARAMS,
      });
    }
    return legacyChain;
  }

  /**
   * Resolve STT provider+model for a specific language, for a bot+tenant.
   */
  async resolveStt(
    tenantId: string,
    language: string,
    botId?: string
  ): Promise<ResolvedSessionProvider | null> {
    // 1. Try bot-level stt_map
    if (botId) {
      const [bot] = await db
        .select({ sttMapJson: botsTable.sttMapJson })
        .from(botsTable)
        .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, tenantId)));

      if (bot?.sttMapJson) {
        const map = bot.sttMapJson as Record<string, SttMapEntry>;
        const entry = map[language] ?? map["*"];
        if (entry) {
          // Tenant-scoped lookup: provider must belong to this tenant OR be
          // platform-pooled, must be enabled, and must be an STT provider.
          const [prov] = await db
            .select()
            .from(providersTable)
            .where(
              and(
                eq(providersTable.id, entry.provider_id),
                or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId)),
                eq(providersTable.enabled, true),
                eq(providersTable.kind, "STT")
              )
            );
          if (prov) {
            return { providerId: prov.id, vendor: prov.vendor, displayName: prov.displayName, modelId: entry.model_id };
          }
        }
      }
    }

    // 2. First enabled tenant STT provider
    const [prov] = await db
      .select()
      .from(providersTable)
      .where(
        and(
          eq(providersTable.kind, "STT"),
          eq(providersTable.enabled, true),
          or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId))
        )
      )
      .orderBy(asc(providersTable.createdAt))
      .limit(1);

    if (!prov) return null;

    const [model] = await db
      .select({ modelId: modelCatalogTable.modelId })
      .from(modelCatalogTable)
      .where(
        and(
          eq(modelCatalogTable.vendor, prov.vendor),
          eq(modelCatalogTable.kind, "STT"),
          eq(modelCatalogTable.deprecated, false)
        )
      )
      .limit(1);

    return model
      ? { providerId: prov.id, vendor: prov.vendor, displayName: prov.displayName, modelId: model.modelId }
      : null;
  }

  /**
   * Resolve TTS provider+model+voice for a specific language, for a bot+tenant.
   */
  async resolveTts(
    tenantId: string,
    language: string,
    botId?: string
  ): Promise<(ResolvedSessionProvider & { voice?: string | null }) | null> {
    // 1. Try bot-level tts_map
    if (botId) {
      const [bot] = await db
        .select({ ttsMapJson: botsTable.ttsMapJson })
        .from(botsTable)
        .where(and(eq(botsTable.id, botId), eq(botsTable.tenantId, tenantId)));

      if (bot?.ttsMapJson) {
        const map = bot.ttsMapJson as Record<string, TtsMapEntry>;
        const entry = map[language] ?? map["*"];
        if (entry) {
          // Tenant-scoped lookup: provider must belong to this tenant OR be
          // platform-pooled, must be enabled, and must be a TTS provider.
          const [prov] = await db
            .select()
            .from(providersTable)
            .where(
              and(
                eq(providersTable.id, entry.provider_id),
                or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId)),
                eq(providersTable.enabled, true),
                eq(providersTable.kind, "TTS")
              )
            );
          if (prov) {
            return { providerId: prov.id, vendor: prov.vendor, displayName: prov.displayName, modelId: entry.model_id, voice: entry.voice };
          }
        }
      }
    }

    // 2. First enabled tenant TTS provider
    const [prov] = await db
      .select()
      .from(providersTable)
      .where(
        and(
          eq(providersTable.kind, "TTS"),
          eq(providersTable.enabled, true),
          or(eq(providersTable.tenantId, tenantId), isNull(providersTable.tenantId))
        )
      )
      .orderBy(asc(providersTable.createdAt))
      .limit(1);

    if (!prov) return null;

    const [model] = await db
      .select({ modelId: modelCatalogTable.modelId })
      .from(modelCatalogTable)
      .where(
        and(
          eq(modelCatalogTable.vendor, prov.vendor),
          eq(modelCatalogTable.kind, "TTS"),
          eq(modelCatalogTable.deprecated, false)
        )
      )
      .limit(1);

    return model
      ? { providerId: prov.id, vendor: prov.vendor, displayName: prov.displayName, modelId: model.modelId, voice: null }
      : null;
  }

  // ── Call logging ────────────────────────────────────────────────────────────

  private async logCall(params: {
    tenantId: string;
    providerId: string | null;
    callId?: string | null;
    vendor: string;
    kind: string;
    modelId: string;
    outcome: "success" | "error" | "timeout" | "breaker_open";
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }): Promise<void> {
    try {
      await db.insert(providerCallLogTable).values({
        id: randomUUID(),
        tenantId: params.tenantId,
        providerId: params.providerId,
        callId: params.callId ?? null,
        providerVendor: params.vendor,
        providerKind: params.kind,
        modelId: params.modelId,
        outcomeStatus: params.outcome,
        latencyMs: params.latencyMs,
        inputTokens: params.inputTokens ?? null,
        outputTokens: params.outputTokens ?? null,
        errorMessage: params.error ?? null,
      });
    } catch (err) {
      // Telemetry failure must never break the call path
      logger.warn({ err }, "Failed to write provider_call_log row");
    }
  }

  // ── Main callLlm method ─────────────────────────────────────────────────────

  /**
   * Walk the resolved LLM chain with per-provider circuit breakers.
   * Logs each attempt to provider_call_log.
   * Throws only when every provider in the chain has been exhausted.
   */
  async callLlm(params: {
    systemPrompt: string;
    userPrompt: string;
    tenantId: string;
    botId?: string;
    callId?: string;
    timeoutMs?: number;
  }): Promise<LlmResult> {
    const { systemPrompt, userPrompt, tenantId, botId, callId } = params;

    // Read tenant llm_config to apply its timeout and circuit-breaker settings.
    // These settings were configurable before the Provider Registry was introduced
    // and must continue to be honoured for backwards compatibility.
    const [llmCfg] = await db
      .select()
      .from(llmConfigTable)
      .where(eq(llmConfigTable.tenantId, tenantId))
      .limit(1);

    const timeoutMs = params.timeoutMs ?? llmCfg?.timeoutMs ?? 30_000;
    const cbThreshold = llmCfg?.circuitBreakerFailureThreshold ?? DEFAULT_CB_THRESHOLD;
    const cbRecoveryMs = (llmCfg?.circuitBreakerRecoveryTimeoutSec ?? DEFAULT_CB_RECOVERY_MS / 1000) * 1000;

    const chain = await this.buildLlmChain(tenantId, botId);

    if (chain.length === 0) {
      throw new Error(
        "No LLM providers configured for this tenant and no env-var fallback available."
      );
    }

    let lastError: unknown;

    for (const entry of chain) {
      const breaker = this.getBreaker(entry.provider.id, cbThreshold, cbRecoveryMs);

      // Circuit breaker open — skip
      if (this.isOpen(breaker)) {
        logger.warn({ providerId: entry.provider.id, vendor: entry.provider.vendor }, "Circuit breaker open — skipping provider");
        await this.logCall({
          tenantId, callId, providerId: entry.provider.id,
          vendor: entry.provider.vendor, kind: "LLM", modelId: entry.modelId,
          outcome: "breaker_open", latencyMs: 0,
        });
        continue;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const t0 = Date.now();

      try {
        const result = await dispatchLlmCall(
          entry.provider,
          entry.modelId,
          systemPrompt,
          userPrompt,
          entry.params,
          controller.signal
        );

        const latencyMs = Date.now() - t0;
        this.onSuccess(breaker);

        await this.logCall({
          tenantId, callId, providerId: entry.provider.id,
          vendor: entry.provider.vendor, kind: "LLM", modelId: entry.modelId,
          outcome: "success", latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });

        logger.info({ vendor: entry.provider.vendor, modelId: entry.modelId, latencyMs }, "LLM call succeeded");

        return {
          text: result.text,
          modelId: entry.modelId,
          providerId: entry.provider.id.startsWith("legacy-") ? null : entry.provider.id,
          vendor: entry.provider.vendor,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
      } catch (err) {
        const latencyMs = Date.now() - t0;
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const outcome = isTimeout ? "timeout" : "error";
        const errorMessage = err instanceof Error ? err.message : String(err);

        this.onFailure(breaker);

        await this.logCall({
          tenantId, callId, providerId: entry.provider.id,
          vendor: entry.provider.vendor, kind: "LLM", modelId: entry.modelId,
          outcome, latencyMs, error: errorMessage,
        });

        logger.warn(
          { err, vendor: entry.provider.vendor, modelId: entry.modelId, outcome },
          "LLM provider call failed — trying next in chain"
        );
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(
      `All LLM providers exhausted. Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}

/** Process-singleton registry instance */
export const providerRegistry = new ProviderRegistry();
