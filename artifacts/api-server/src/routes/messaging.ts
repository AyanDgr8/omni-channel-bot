import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, messageLogsTable } from "@workspace/db";
import {
  SendWhatsAppBody,
  SendWhatsAppResponse,
  SendTelegramBody,
  SendTelegramResponse,
  SendEmailBody,
  SendEmailResponse,
  ListMessageLogsQueryParams,
  ListMessageLogsResponse,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.post("/v1/messaging/whatsapp", async (req, res): Promise<void> => {
  const parsed = SendWhatsAppBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const msgId = `wa_${randomUUID().split("-")[0]}`;
  await db.insert(messageLogsTable).values({
    id: randomUUID(),
    channel: "whatsapp",
    recipient: parsed.data.to,
    templateName: parsed.data.templateName ?? null,
    messageId: msgId,
    status: "sent",
    callId: parsed.data.callId ?? null,
  });
  res.json(SendWhatsAppResponse.parse({ success: true, messageId: msgId, channel: "whatsapp", deliveryStatus: "sent" }));
});

router.post("/v1/messaging/telegram", async (req, res): Promise<void> => {
  const parsed = SendTelegramBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const msgId = `tg_${randomUUID().split("-")[0]}`;
  await db.insert(messageLogsTable).values({
    id: randomUUID(),
    channel: "telegram",
    recipient: parsed.data.chatId,
    messageId: msgId,
    status: "sent",
    callId: parsed.data.callId ?? null,
  });
  res.json(SendTelegramResponse.parse({ success: true, messageId: msgId, channel: "telegram", deliveryStatus: "sent" }));
});

router.post("/v1/messaging/email", async (req, res): Promise<void> => {
  const parsed = SendEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const msgId = `em_${randomUUID().split("-")[0]}`;
  await db.insert(messageLogsTable).values({
    id: randomUUID(),
    channel: "email",
    recipient: parsed.data.to,
    templateName: parsed.data.templateName,
    messageId: msgId,
    status: "sent",
    callId: parsed.data.callId ?? null,
  });
  res.json(SendEmailResponse.parse({ success: true, messageId: msgId, channel: "email", deliveryStatus: "sent" }));
});

router.get("/v1/messaging/logs", async (req, res): Promise<void> => {
  const params = ListMessageLogsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const channel = params.success ? params.data.channel : undefined;

  const logs = await db
    .select()
    .from(messageLogsTable)
    .where(channel ? eq(messageLogsTable.channel, channel) : undefined)
    .limit(limit);

  res.json(ListMessageLogsResponse.parse(logs));
});

export default router;
