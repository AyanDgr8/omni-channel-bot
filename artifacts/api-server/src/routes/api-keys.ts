import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SERVICES = [
  { key: "openai", envVar: "OPENAI_API_KEY", label: "OpenAI", prefix: "sk-" },
  { key: "gemini", envVar: "GEMINI_API_KEY", label: "Google Gemini", prefix: "AIza" },
  { key: "deepgram", envVar: "DEEPGRAM_API_KEY", label: "Deepgram", prefix: "" },
] as const;

function maskKey(value: string): string {
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 6) + "••••••••" + value.slice(-4);
}

router.get("/v1/config/api-keys", (req, res) => {
  const result: Record<string, { isSet: boolean; preview: string | null; label: string }> = {};
  for (const svc of SERVICES) {
    const val = process.env[svc.envVar];
    result[svc.key] = {
      isSet: !!val,
      preview: val ? maskKey(val) : null,
      label: svc.label,
    };
  }
  res.json(result);
});

router.post("/v1/config/api-keys/:service/test", async (req, res): Promise<void> => {
  const { service } = req.params;
  const svc = SERVICES.find((s) => s.key === service);
  if (!svc) {
    res.status(404).json({ success: false, error: "Unknown service" });
    return;
  }

  const apiKey = process.env[svc.envVar];
  if (!apiKey) {
    res.json({ success: false, error: "API key not configured" });
    return;
  }

  try {
    if (service === "openai") {
      const resp = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (resp.ok) {
        const data = await resp.json() as { data?: unknown[] };
        res.json({ success: true, message: `Connected — ${data.data?.length ?? 0} models available` });
      } else {
        const err = await resp.json() as { error?: { message?: string } };
        res.json({ success: false, error: err.error?.message ?? "Authentication failed" });
      }
    } else if (service === "gemini") {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      if (resp.ok) {
        const data = await resp.json() as { models?: unknown[] };
        res.json({ success: true, message: `Connected — ${data.models?.length ?? 0} models available` });
      } else {
        const err = await resp.json() as { error?: { message?: string } };
        res.json({ success: false, error: err.error?.message ?? "Authentication failed" });
      }
    } else if (service === "deepgram") {
      const resp = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${apiKey}` },
      });
      if (resp.ok) {
        res.json({ success: true, message: "Connected — Deepgram authentication verified" });
      } else {
        res.json({ success: false, error: "Authentication failed" });
      }
    } else {
      res.json({ success: false, error: "Test not implemented for this service" });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error";
    res.json({ success: false, error: `Connection failed: ${message}` });
  }
});

export default router;
