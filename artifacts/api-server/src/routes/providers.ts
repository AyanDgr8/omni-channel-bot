/**
 * Provider Registry CRUD
 * FR-TECH-09: BYO-keys per provider, encrypted at rest.
 * FR-TECH-09: Platform-pooled providers (tenantId IS NULL) are visible but not mutable by tenant users.
 */
import { Router, type IRouter } from "express";
import { eq, and, or, isNull, asc } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db, providersTable } from "@workspace/db";
import { requireRole } from "../middleware/require-role.js";
import { auditMiddleware } from "../middleware/audit.js";
import { encryptKey, decryptKey, maskKey } from "../lib/key-crypto.js";
import { validateBaseUrl, ssrfSafeFetch } from "../lib/ssrf-guard.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const CreateProviderBody = z.object({
  kind: z.enum(["LLM", "STT", "TTS"]),
  vendor: z.string().min(1),
  displayName: z.string().min(1),
  /** Plain-text key — encrypted before storage; never returned to clients */
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().nullable(),
  authMode: z.enum(["bearer", "api-key", "none"]).default("bearer"),
  configJson: z.record(z.unknown()).optional().nullable(),
  enabled: z.boolean().default(true),
});

const UpdateProviderBody = z.object({
  displayName: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().optional(),
  configJson: z.record(z.unknown()).optional().nullable(),
});

/**
 * Strip encrypted key; return masked preview only for the requesting tenant's
 * own providers.  Platform-pooled providers (tenantId IS NULL) must never expose
 * credential material — even a masked preview — to tenant users.
 */
function sanitize(
  row: typeof providersTable.$inferSelect,
  requestingTenantId?: string
) {
  const { apiKeyEncrypted, ...rest } = row;
  const isOwn = row.tenantId !== null && row.tenantId === requestingTenantId;
  const decrypted = (isOwn && apiKeyEncrypted) ? decryptKey(apiKeyEncrypted) : null;
  return {
    ...rest,
    keyIsSet: !!apiKeyEncrypted,
    // keyPreview is null for platform-pooled providers — their credentials
    // belong to the platform operator and must not leak to tenant users.
    keyPreview: decrypted ? maskKey(decrypted) : null,
    isPlatformPooled: row.tenantId === null,
  };
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get("/v1/providers", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(providersTable)
    .where(or(eq(providersTable.tenantId, req.tenantId!), isNull(providersTable.tenantId)))
    .orderBy(asc(providersTable.createdAt));
  res.json(rows.map((r) => sanitize(r, req.tenantId!)));
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post(
  "/v1/providers",
  requireRole("ADMIN"),
  auditMiddleware("provider"),
  async (req, res): Promise<void> => {
    const parsed = CreateProviderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { apiKey, configJson, ...rest } = parsed.data;

    // Validate custom base URL before persisting — prevents storing SSRF targets.
    if (rest.baseUrl) {
      try {
        await validateBaseUrl(rest.baseUrl);
      } catch (err) {
        res.status(400).json({ error: `baseUrl rejected: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    }

    const [row] = await db
      .insert(providersTable)
      .values({
        id: randomUUID(),
        tenantId: req.tenantId!,
        ...rest,
        apiKeyEncrypted: apiKey ? encryptKey(apiKey) : null,
        configJson: configJson ?? null,
      })
      .returning();
    res.status(201).json(sanitize(row, req.tenantId!));
  }
);

// ─── Get single ───────────────────────────────────────────────────────────────

router.get("/v1/providers/:id", async (req, res): Promise<void> => {
  const id = req.params.id as string;
  const [row] = await db
    .select()
    .from(providersTable)
    .where(and(eq(providersTable.id, id), or(eq(providersTable.tenantId, req.tenantId!), isNull(providersTable.tenantId))));
  if (!row) { res.status(404).json({ error: "Provider not found" }); return; }
  res.json(sanitize(row, req.tenantId!));
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.patch(
  "/v1/providers/:id",
  requireRole("ADMIN"),
  auditMiddleware("provider"),
  async (req, res): Promise<void> => {
    const id = req.params.id as string;
    const parsed = UpdateProviderBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    // Tenant may only update their own rows (not platform-pooled)
    const [existing] = await db
      .select()
      .from(providersTable)
      .where(and(eq(providersTable.id, id), eq(providersTable.tenantId, req.tenantId!)));
    if (!existing) { res.status(404).json({ error: "Provider not found" }); return; }

    const { apiKey, configJson, baseUrl, ...fields } = parsed.data;

    // Validate updated base URL before persisting.
    if (baseUrl !== undefined && baseUrl !== null) {
      try {
        await validateBaseUrl(baseUrl);
      } catch (err) {
        res.status(400).json({ error: `baseUrl rejected: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    }

    const updateSet: Record<string, unknown> = {
      ...fields,
      updatedAt: new Date(),
    };
    if (baseUrl !== undefined) {
      updateSet.baseUrl = baseUrl;
    }
    if (apiKey !== undefined) {
      updateSet.apiKeyEncrypted = apiKey ? encryptKey(apiKey) : null;
    }
    if (configJson !== undefined) {
      updateSet.configJson = configJson;
    }

    const [row] = await db
      .update(providersTable)
      .set(updateSet)
      .where(and(eq(providersTable.id, id), eq(providersTable.tenantId, req.tenantId!)))
      .returning();
    if (!row) { res.status(404).json({ error: "Provider not found" }); return; }
    res.json(sanitize(row, req.tenantId!));
  }
);

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete(
  "/v1/providers/:id",
  requireRole("ADMIN"),
  auditMiddleware("provider"),
  async (req, res): Promise<void> => {
    const id = req.params.id as string;
    const [row] = await db
      .delete(providersTable)
      .where(and(eq(providersTable.id, id), eq(providersTable.tenantId, req.tenantId!)))
      .returning();
    if (!row) { res.status(404).json({ error: "Provider not found" }); return; }
    res.sendStatus(204);
  }
);

// ─── Test key connectivity ────────────────────────────────────────────────────

router.post("/v1/providers/:id/test-key", requireRole("ADMIN"), async (req, res): Promise<void> => {
  const id = req.params.id as string;
  const [row] = await db
    .select()
    .from(providersTable)
    .where(and(eq(providersTable.id, id), or(eq(providersTable.tenantId, req.tenantId!), isNull(providersTable.tenantId))));
  if (!row) { res.status(404).json({ success: false, error: "Provider not found" }); return; }

  // Platform-pooled providers (tenantId IS NULL) belong to the platform operator.
  // Tenant users must not be able to test-consume or verify platform credentials.
  if (row.tenantId === null) {
    res.status(403).json({
      success: false,
      error: "Cannot test platform-pooled provider credentials from a tenant context.",
    });
    return;
  }

  if (!row.apiKeyEncrypted) {
    res.json({ success: false, error: "No API key stored for this provider" });
    return;
  }

  const apiKey = decryptKey(row.apiKeyEncrypted);
  if (!apiKey) {
    res.json({ success: false, error: "Failed to decrypt stored API key" });
    return;
  }

  // SSRF guard: validate any custom baseUrl before making outbound requests
  if (row.baseUrl) {
    try {
      await validateBaseUrl(row.baseUrl);
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : "Invalid base URL",
      });
      return;
    }
  }

  const t0 = Date.now();
  try {
    const result = await testConnectivity(row.vendor, apiKey, row.baseUrl ?? null, row.authMode);
    res.json({ ...result, latencyMs: Date.now() - t0 });
  } catch (err) {
    logger.warn({ err, vendor: row.vendor }, "Provider connectivity test error");
    res.json({ success: false, error: err instanceof Error ? err.message : "Network error", latencyMs: Date.now() - t0 });
  }
});

async function testConnectivity(
  vendor: string,
  apiKey: string,
  baseUrl: string | null,
  authMode: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const authHeader: Record<string, string> = authMode === "api-key"
    ? { "x-api-key": apiKey }
    : { Authorization: `Bearer ${apiKey}` };

  // All fetch() calls in this function use redirect:"error" to prevent
  // HTTP-redirect-based SSRF: a validated public endpoint cannot redirect
  // the server to an internal address.
  const REDIRECT_SAFE = { redirect: "error" } as const;

  switch (vendor) {
    case "openai":
    case "openai-compatible": {
      const resolvedBase = baseUrl ?? "https://api.openai.com/v1";
      const url = resolvedBase + "/models";
      const init = { headers: authHeader, ...REDIRECT_SAFE } as RequestInit;
      // Use ssrfSafeFetch for custom URLs (IP-pins the connection to the vetted address)
      const r = baseUrl
        ? await ssrfSafeFetch(url, init)
        : await fetch(url, init);
      if (r.ok) {
        const d = await r.json() as { data?: unknown[] };
        return { success: true, message: `Connected — ${d.data?.length ?? "?"} models` };
      }
      const e = await r.json() as { error?: { message?: string } };
      return { success: false, error: e.error?.message ?? `HTTP ${r.status}` };
    }
    case "sarvam": {
      const resolvedBase = baseUrl ?? "https://api.sarvam.ai/v1";
      const url = resolvedBase + "/models";
      const init = { headers: authHeader, ...REDIRECT_SAFE } as RequestInit;
      const r = baseUrl
        ? await ssrfSafeFetch(url, init)
        : await fetch(url, init);
      if (r.ok) return { success: true, message: "Connected to Sarvam API" };
      return { success: false, error: `HTTP ${r.status}` };
    }
    case "anthropic": {
      // Minimal messages call with max_tokens=1 to validate key
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        ...REDIRECT_SAFE,
      } as RequestInit);
      if (r.ok || r.status === 400) return { success: true, message: "Anthropic key authenticated" };
      const e = await r.json() as { error?: { message?: string } };
      return { success: false, error: e.error?.message ?? `HTTP ${r.status}` };
    }
    case "google-gemini": {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        REDIRECT_SAFE as RequestInit
      );
      if (r.ok) {
        const d = await r.json() as { models?: unknown[] };
        return { success: true, message: `Connected — ${d.models?.length ?? "?"} models` };
      }
      const e = await r.json() as { error?: { message?: string } };
      return { success: false, error: e.error?.message ?? `HTTP ${r.status}` };
    }
    case "deepgram":
    case "deepgram-aura": {
      const r = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${apiKey}` },
        ...REDIRECT_SAFE,
      } as RequestInit);
      if (r.ok) return { success: true, message: "Deepgram key authenticated" };
      return { success: false, error: `HTTP ${r.status}` };
    }
    case "elevenlabs": {
      const r = await fetch("https://api.elevenlabs.io/v1/models", {
        headers: { "xi-api-key": apiKey },
        ...REDIRECT_SAFE,
      } as RequestInit);
      if (r.ok) return { success: true, message: "ElevenLabs key authenticated" };
      return { success: false, error: `HTTP ${r.status}` };
    }
    case "google": {
      // Google STT/TTS uses ADC; key-based auth varies — basic check only
      return { success: true, message: "Google key stored (full validation requires ADC setup)" };
    }
    case "azure": {
      return { success: true, message: "Azure key stored (endpoint validation requires region config)" };
    }
    case "cartesia": {
      const r = await fetch("https://api.cartesia.ai/voices", {
        headers: { "X-API-Key": apiKey, "Cartesia-Version": "2024-06-10" },
        ...REDIRECT_SAFE,
      } as RequestInit);
      if (r.ok) return { success: true, message: "Cartesia key authenticated" };
      return { success: false, error: `HTTP ${r.status}` };
    }
    case "whisper-compatible": {
      if (!baseUrl) return { success: false, error: "whisper-compatible provider requires a baseUrl" };
      const url = baseUrl + "/models";
      // Always a custom URL — use ssrfSafeFetch for DNS-pinned, redirect-safe connection
      const r = await ssrfSafeFetch(url, { headers: authHeader, ...REDIRECT_SAFE } as RequestInit);
      if (r.ok) return { success: true, message: "Whisper-compatible endpoint reachable" };
      return { success: false, error: `HTTP ${r.status}` };
    }
    default:
      return { success: true, message: `Key stored for ${vendor} (no connectivity test implemented)` };
  }
}

export default router;
