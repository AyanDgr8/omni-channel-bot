import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, emailAgentConfigTable, writingStyleProfilesTable } from "@workspace/db";

const router: IRouter = Router();

// ─── MS Graph token cache ───────────────────────────────────────────────────
let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getGraphToken(cfg: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }
  const url = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token fetch failed: ${err}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _tokenCache.token;
}

async function graphGet(path: string, cfg: { tenantId: string; clientId: string; clientSecret: string }) {
  const token = await getGraphToken(cfg);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function graphPost(
  path: string,
  body: unknown,
  cfg: { tenantId: string; clientId: string; clientSecret: string }
) {
  const token = await getGraphToken(cfg);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

async function getConfig() {
  const rows = await db.select().from(emailAgentConfigTable).where(eq(emailAgentConfigTable.id, "default"));
  if (!rows.length) return null;
  return rows[0];
}

// ─── Config CRUD ─────────────────────────────────────────────────────────────

router.get("/v1/email-agent/config", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg) {
    res.json({
      id: "default",
      tenantId: "",
      clientId: "",
      clientSecret: "",
      userEmail: "",
      isEnabled: false,
    });
    return;
  }
  // Never expose the clientSecret back to the frontend
  res.json({ ...cfg, clientSecret: cfg.clientSecret ? "••••••••" : "" });
});

router.put("/v1/email-agent/config", async (req, res) => {
  const { tenantId, clientId, clientSecret, userEmail, isEnabled } = req.body as {
    tenantId: string;
    clientId: string;
    clientSecret?: string;
    userEmail: string;
    isEnabled: boolean;
  };
  const existing = await getConfig();
  // Keep the stored secret if the caller sends the masked placeholder
  const secretToStore =
    clientSecret && clientSecret !== "••••••••" ? clientSecret : (existing?.clientSecret ?? "");

  await db
    .insert(emailAgentConfigTable)
    .values({ id: "default", tenantId, clientId, clientSecret: secretToStore, userEmail, isEnabled })
    .onConflictDoUpdate({
      target: emailAgentConfigTable.id,
      set: { tenantId, clientId, clientSecret: secretToStore, userEmail, isEnabled, updatedAt: new Date() },
    });
  _tokenCache = null; // invalidate cached token
  res.json({ success: true });
});

router.post("/v1/email-agent/test-connection", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg || !cfg.tenantId || !cfg.clientId || !cfg.clientSecret || !cfg.userEmail) {
    res.status(400).json({ success: false, error: "Configuration incomplete" });
    return;
  }
  try {
    await graphGet(`/users/${cfg.userEmail}/mailFolders/inbox`, cfg);
    res.json({ success: true, message: "Connected to Microsoft 365 mailbox successfully" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ success: false, error: message });
  }
});

// ─── Inbox ───────────────────────────────────────────────────────────────────

router.get("/v1/email-agent/inbox", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg?.isEnabled) { res.status(400).json({ error: "Email agent not configured" }); return; }
  const top = Number(req.query.top ?? 30);
  const skip = Number(req.query.skip ?? 0);
  const data = await graphGet(
    `/users/${cfg.userEmail}/messages?$top=${top}&$skip=${skip}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments&$orderby=receivedDateTime desc`,
    cfg
  );
  res.json(data);
});

// ─── Search ──────────────────────────────────────────────────────────────────

router.get("/v1/email-agent/search", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg?.isEnabled) { res.status(400).json({ error: "Email agent not configured" }); return; }
  const q = String(req.query.q ?? "");
  if (!q) { res.status(400).json({ error: "q is required" }); return; }
  // Build OData filter — support free-text search via $search
  const data = await graphGet(
    `/users/${cfg.userEmail}/messages?$search="${encodeURIComponent(q)}"&$top=20&$select=id,subject,from,receivedDateTime,isRead,bodyPreview`,
    cfg
  );
  res.json(data);
});

// ─── Single message / thread ─────────────────────────────────────────────────

router.get("/v1/email-agent/message/:id", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg?.isEnabled) { res.status(400).json({ error: "Email agent not configured" }); return; }
  const data = await graphGet(
    `/users/${cfg.userEmail}/messages/${req.params.id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,hasAttachments`,
    cfg
  );
  res.json(data);
});

router.get("/v1/email-agent/thread/:conversationId", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg?.isEnabled) { res.status(400).json({ error: "Email agent not configured" }); return; }
  const data = await graphGet(
    `/users/${cfg.userEmail}/messages?$filter=conversationId eq '${req.params.conversationId}'&$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview&$orderby=receivedDateTime asc&$top=50`,
    cfg
  );
  res.json(data);
});

// ─── Reply draft ─────────────────────────────────────────────────────────────

router.post("/v1/email-agent/reply", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg?.isEnabled) { res.status(400).json({ error: "Email agent not configured" }); return; }
  const { messageId, body, send } = req.body as { messageId: string; body: string; send?: boolean };
  if (send) {
    await graphPost(`/users/${cfg.userEmail}/messages/${messageId}/reply`, { message: { body: { contentType: "HTML", content: body } }, comment: "" }, cfg);
    res.json({ success: true, sent: true });
  } else {
    // Create a draft reply
    const draft = await graphPost(`/users/${cfg.userEmail}/messages/${messageId}/createReply`, {}, cfg);
    // Update the draft body
    await fetch(`https://graph.microsoft.com/v1.0/users/${cfg.userEmail}/messages/${(draft as any).id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await getGraphToken(cfg)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: { contentType: "HTML", content: body } }),
    });
    res.json({ success: true, sent: false, draftId: (draft as any).id });
  }
});

// ─── Send call summary ───────────────────────────────────────────────────────

router.post("/v1/email-agent/send-summary", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg?.isEnabled) { res.status(400).json({ error: "Email agent not configured" }); return; }
  const { toEmail, customerName, summary, subject } = req.body as {
    toEmail: string;
    customerName: string;
    summary: string;
    subject?: string;
  };

  // Fetch writing style template
  const styleRows = await db.select().from(writingStyleProfilesTable).where(eq(writingStyleProfilesTable.id, "default"));
  const style = styleRows[0];
  const template = style?.callSummaryTemplate ??
    "Hi {{customerName}},\n\nThank you for speaking with us today.\n\n{{summary}}\n\n{{signOff}}";
  const signOff = style?.signOff ?? "Best regards,";
  const bodyText = template
    .replace(/{{customerName}}/g, customerName)
    .replace(/{{summary}}/g, summary)
    .replace(/{{signOff}}/g, signOff);

  const htmlBody = bodyText.replace(/\n/g, "<br>");
  const emailSubject = subject ?? `Call Summary — ${new Date().toLocaleDateString()}`;

  await graphPost(
    `/users/${cfg.userEmail}/sendMail`,
    {
      message: {
        subject: emailSubject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: [{ emailAddress: { address: toEmail, name: customerName } }],
        ccRecipients: [{ emailAddress: { address: cfg.userEmail } }],
      },
      saveToSentItems: true,
    },
    cfg
  );
  res.json({ success: true });
});

// ─── Writing style ───────────────────────────────────────────────────────────

router.get("/v1/email-agent/style", async (req, res) => {
  const rows = await db.select().from(writingStyleProfilesTable).where(eq(writingStyleProfilesTable.id, "default"));
  if (!rows.length) {
    res.json({ id: "default", greeting: "Hi,", signOff: "Best regards,", tone: "professional", callSummaryTemplate: "Hi {{customerName}},\n\nThank you for speaking with us today.\n\n{{summary}}\n\n{{signOff}}", styleExamples: [], learnedPatterns: {} });
    return;
  }
  res.json(rows[0]);
});

router.put("/v1/email-agent/style", async (req, res) => {
  const { greeting, signOff, tone, callSummaryTemplate } = req.body as {
    greeting: string;
    signOff: string;
    tone: string;
    callSummaryTemplate: string;
  };
  await db
    .insert(writingStyleProfilesTable)
    .values({ id: "default", greeting, signOff, tone, callSummaryTemplate })
    .onConflictDoUpdate({
      target: writingStyleProfilesTable.id,
      set: { greeting, signOff, tone, callSummaryTemplate, updatedAt: new Date() },
    });
  res.json({ success: true });
});

router.post("/v1/email-agent/learn-style", async (req, res) => {
  const cfg = await getConfig();
  if (!cfg?.isEnabled) { res.status(400).json({ error: "Email agent not configured" }); return; }
  // Fetch last 50 sent messages and extract patterns
  const data = (await graphGet(
    `/users/${cfg.userEmail}/mailFolders/SentItems/messages?$top=50&$select=body,subject&$orderby=sentDateTime desc`,
    cfg
  )) as { value: Array<{ body: { content: string }; subject: string }> };

  const examples = (data.value ?? [])
    .slice(0, 20)
    .map((m) => m.body?.content?.replace(/<[^>]*>/g, "").slice(0, 300) ?? "")
    .filter(Boolean);

  // Simple pattern extraction: most common greeting and sign-off
  const greetingCandidates = examples.map((e) => e.split("\n")[0]?.trim()).filter(Boolean);
  const signOffCandidates = examples.map((e) => {
    const lines = e.trim().split("\n").filter(Boolean);
    return lines[lines.length - 1]?.trim() ?? "";
  }).filter(Boolean);

  const mode = (arr: string[]) => {
    const freq: Record<string, number> = {};
    for (const s of arr) freq[s] = (freq[s] ?? 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };

  const greeting = mode(greetingCandidates) || "Hi,";
  const signOff = mode(signOffCandidates) || "Best regards,";

  await db
    .insert(writingStyleProfilesTable)
    .values({ id: "default", greeting, signOff, styleExamples: examples, lastLearnedAt: new Date() })
    .onConflictDoUpdate({
      target: writingStyleProfilesTable.id,
      set: { greeting, signOff, styleExamples: examples, learnedPatterns: { sampledAt: new Date().toISOString(), count: examples.length }, lastLearnedAt: new Date(), updatedAt: new Date() },
    });

  res.json({ success: true, greeting, signOff, sampledCount: examples.length });
});

export default router;
