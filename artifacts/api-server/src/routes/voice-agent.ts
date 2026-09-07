/**
 * Voice Agent — the browser-side "talk to the assistant" experience.
 *
 * Speech-to-text and text-to-speech run in the browser (Web Speech API); this
 * route supplies only the reply text. It goes through providerRegistry.callLlm
 * so the tenant's configured provider chain, failover and circuit breakers all
 * apply, exactly as they do for a real call.
 */
import { Router, type IRouter } from "express";
import { providerRegistry } from "../lib/provider-registry";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Guard rails on untrusted client input. */
const MAX_TURNS = 24;
const MAX_CONTENT_CHARS = 2_000;
const MAX_NAME_CHARS = 60;
const MAX_SPEECH_CHARS = 2_000;
const DEEPGRAM_VOICES = new Set([
  "aura-2-helena-en", "aura-2-thalia-en", "aura-2-luna-en", "aura-2-vesta-en",
  "aura-2-orpheus-en", "aura-2-arcas-en", "aura-2-zeus-en",
  "aura-2-pandora-en", "aura-2-draco-en", "aura-2-theia-en", "aura-2-hyperion-en",
  "aura-2-amalthea-en", "aura-2-celeste-es", "aura-2-nestor-es",
  "aura-2-agathe-fr", "aura-2-hector-fr", "aura-2-viktoria-de", "aura-2-julius-de",
  "aura-2-livia-it", "aura-2-dionisio-it", "aura-2-izanami-ja", "aura-2-fujin-ja",
]);

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = [
  "You are Vox, the voice assistant for the VoxAgent control plane.",
  "Your replies are read aloud, so keep them short — one or two sentences, 40 words at most.",
  "Speak naturally and warmly, like a helpful colleague on a phone call. Never use markdown,",
  "bullet points, emoji, or stage directions; write only words a person would say out loud.",
  "Use natural conversational phrasing, contractions and varied sentence length. Avoid robotic",
  "phrases, repeated disclaimers, canned call-centre wording, and unnecessary repetition.",
  "Answer the caller's question directly and accurately, then usually ask one short, relevant",
  "follow-up question so the conversation keeps moving. Do not repeat a question already answered.",
  "Use your web-search tool whenever the answer depends on current or changing information, including",
  "sports fixtures and scores, news, schedules, prices, office holders, and recent events. Give the",
  "specific answer, date and local time when available; never tell the caller to search elsewhere.",
  "Detect the language of the caller's latest message and answer entirely in that same language.",
  "You have a live weather tool. When the caller asks about current weather or a forecast, do not",
  "refuse and do not guess. Return only [[tool:weather]] followed by compact JSON containing",
  "location and language, for example [[tool:weather]]{\"location\":\"Dwarka Sector 14, Delhi\",\"language\":\"hi-IN\"}.",
  "Begin every response with a machine-readable locale marker such as [[language:hi-IN]] or",
  "[[language:es-ES]], immediately followed by the spoken answer. The weather tool request is the",
  "only exception; after tool results are supplied, use the normal language marker and answer.",
  "Expand digits and symbols into words where it helps them be spoken (say 'twenty-four seven',",
  "not '24/7'). If you do not know something, say so briefly and offer what you can do instead.",
].join(" ");

function extractLocalizedReply(text: string): { reply: string; language: string | null } {
  const match = text.match(/^\s*\[\[language:([a-z]{2,3}(?:-[A-Z]{2})?)\]\]\s*/i);
  return {
    reply: match ? text.slice(match[0].length).trim() : text.trim(),
    language: match?.[1] ?? null,
  };
}

function extractWeatherRequest(text: string): { location: string; language: string } | null {
  const marker = "[[tool:weather]]";
  const index = text.indexOf(marker);
  if (index < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(index + marker.length).trim()) as { location?: unknown; language?: unknown };
    if (typeof parsed.location !== "string" || !parsed.location.trim()) return null;
    return {
      location: parsed.location.trim().slice(0, 180),
      language: typeof parsed.language === "string" ? parsed.language : "en-US",
    };
  } catch {
    return null;
  }
}

async function getWeather(location: string) {
  type Place = { name: string; admin1?: string; country?: string; latitude: number; longitude: number };
  const candidates = [...new Set([
    location,
    ...location.split(",").map((part) => part.trim()).reverse(),
    location.replace(/\b(?:sector|block)\s*[a-z0-9-]+/gi, "").replace(/\s+/g, " ").trim(),
  ].filter(Boolean))];
  let place: Place | undefined;
  for (const candidate of candidates) {
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", candidate);
    geocodeUrl.searchParams.set("count", "1");
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("format", "json");
    const geocodeResponse = await fetch(geocodeUrl, { signal: AbortSignal.timeout(8_000), redirect: "error" });
    if (!geocodeResponse.ok) continue;
    const geocode = await geocodeResponse.json() as { results?: Place[] };
    place = geocode.results?.[0];
    if (place) break;
  }
  if (!place) throw new Error(`Weather location not found: ${location}`);

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(place.latitude));
  forecastUrl.searchParams.set("longitude", String(place.longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,wind_speed_10m");
  forecastUrl.searchParams.set("hourly", "precipitation_probability,temperature_2m,weather_code");
  forecastUrl.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max");
  forecastUrl.searchParams.set("forecast_days", "3");
  forecastUrl.searchParams.set("timezone", "auto");
  const forecastResponse = await fetch(forecastUrl, { signal: AbortSignal.timeout(8_000), redirect: "error" });
  if (!forecastResponse.ok) throw new Error(`Weather forecast failed (${forecastResponse.status})`);
  return {
    resolvedLocation: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    source: "Open-Meteo",
    fetchedAt: new Date().toISOString(),
    forecast: await forecastResponse.json(),
  };
}

/** The registry exposes a single system+user pair, so the turns are flattened. */
function flattenTranscript(turns: Turn[], userName: string | null): string {
  const header = userName
    ? `You are speaking with ${userName}. Use their name occasionally, not in every reply.`
    : "You do not know the caller's name yet.";
  const body = turns
    .map((t) => `${t.role === "user" ? "Caller" : "You"}: ${t.content}`)
    .join("\n");
  return `${header}\n\nConversation so far:\n${body}\n\nReply as Vox, out loud, to the caller's last message.`;
}

function sanitizeTurns(raw: unknown): Turn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: Turn[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    const trimmed = content.trim();
    if (!trimmed) continue;
    turns.push({ role, content: trimmed.slice(0, MAX_CONTENT_CHARS) });
  }
  // Only the tail matters for a spoken conversation, and it bounds the prompt.
  return turns.slice(-MAX_TURNS);
}

router.post("/v1/voice-agent/speech", async (req, res): Promise<void> => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const model = typeof req.body?.model === "string" ? req.body.model : "";
  if (!text || text.length > MAX_SPEECH_CHARS) {
    res.status(400).json({ error: `text must be between 1 and ${MAX_SPEECH_CHARS} characters` });
    return;
  }
  if (!DEEPGRAM_VOICES.has(model)) {
    res.status(400).json({ error: "Unsupported voice model" });
    return;
  }
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ error: "Deepgram TTS is not configured" });
    return;
  }

  try {
    const url = new URL("https://api.deepgram.com/v1/speak");
    url.searchParams.set("model", model);
    url.searchParams.set("encoding", "mp3");
    const upstream = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!upstream.ok) {
      logger.warn({ status: upstream.status }, "Deepgram speech synthesis failed");
      res.status(502).json({ error: `Speech provider returned ${upstream.status}` });
      return;
    }
    res.type("audio/mpeg").send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    logger.warn({ error }, "voice-agent speech request failed");
    res.status(502).json({ error: "Speech synthesis failed" });
  }
});

router.post("/v1/voice-agent/reply", async (req, res): Promise<void> => {
  const { messages, userName } = req.body as {
    messages?: unknown;
    userName?: unknown;
  };

  const turns = sanitizeTurns(messages);
  if (!turns) {
    res.status(400).json({ error: "messages must be an array of {role, content}" });
    return;
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    res.status(400).json({ error: "The last message must be from the user" });
    return;
  }

  const name =
    typeof userName === "string" && userName.trim()
      ? userName.trim().slice(0, MAX_NAME_CHARS)
      : null;

  try {
    let result = await providerRegistry.callLlm({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: flattenTranscript(turns, name),
      tenantId: req.tenantId!,
      timeoutMs: 45_000,
      webSearch: true,
    });
    const weatherRequest = extractWeatherRequest(result.text);
    if (weatherRequest) {
      const weather = await getWeather(weatherRequest.location);
      result = await providerRegistry.callLlm({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `${flattenTranscript(turns, name)}\n\nLIVE WEATHER TOOL RESULT:\n${JSON.stringify(weather)}\n\nAnswer the caller's weather question using these live figures. Mention the resolved location, rain probability and useful timing. Answer in ${weatherRequest.language}. Do not request the tool again.`,
        tenantId: req.tenantId!,
        timeoutMs: 45_000,
        webSearch: true,
      });
    }
    const localized = extractLocalizedReply(result.text);
    res.json({ ...localized, engine: result.vendor, model: result.modelId });
  } catch (err) {
    // A voice UI cannot show a stack trace — always give it something to say.
    logger.warn({ err }, "voice-agent reply failed; returning fallback");
    res.json({
      reply: name
        ? `Sorry ${name}, I'm having trouble reaching my language model right now. Could you try again in a moment?`
        : "Sorry, I'm having trouble reaching my language model right now. Could you try again in a moment?",
      engine: "fallback",
      degraded: true,
    });
  }
});

export default router;
