import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  botsTable,
  db,
  insertSipEvent,
  sipConfigsTable,
  sipEventsTable,
  tenantsTable,
} from "@workspace/db";

const tenantId = `sip-model-tenant-${randomUUID()}`;
const botId = `sip-model-bot-${randomUUID()}`;

afterAll(async () => {
  await db.delete(botsTable).where(eq(botsTable.id, botId)).catch(() => {});
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId)).catch(() => {});
});

describe("SIP data model", () => {
  it("uses WebRTC and SIP configuration defaults", async () => {
    await db.insert(tenantsTable).values({
      id: tenantId,
      name: "SIP Model Test Tenant",
      slug: `sip-model-${tenantId.slice(-12)}`,
      webhookSecret: `secret-${tenantId}`,
    });
    await db.insert(botsTable).values({
      id: botId,
      tenantId,
      displayName: "SIP model test bot",
      sipExtension: "1001",
    });
    await db.insert(sipConfigsTable).values({
      id: `sip-config-${randomUUID()}`,
      tenantId,
      botId,
      registrarHost: "pbx.example.test",
      extension: "1001",
      authUsername: "1001",
    });

    const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
    const [config] = await db.select().from(sipConfigsTable).where(eq(sipConfigsTable.botId, botId));

    expect(bot.telephonyType).toBe("webrtc");
    expect(config).toMatchObject({
      enabled: true,
      registrarPort: 5060,
      transport: "udp",
      registerExpirySeconds: 300,
      keepaliveIntervalSeconds: 30,
      codecs: ["PCMU", "PCMA"],
      dtmfMode: "rfc2833",
      srtpMode: "disabled",
      ptimeMs: 20,
      natTraversal: "none",
      maxConcurrentCalls: 1,
      answerDelayMs: 0,
      recordCalls: false,
      outboundEnabled: false,
      allowSelfSigned: false,
      debug: false,
      registrationState: "unregistered",
      activeCalls: 0,
    });
  });

  it("retains only the newest 500 events per bot", async () => {
    for (let sequence = 0; sequence < 501; sequence += 1) {
      await insertSipEvent({
        tenantId,
        botId,
        level: "info",
        summary: `event-${sequence}`,
        timestamp: new Date(1_700_000_000_000 + sequence),
      });
    }

    const [{ eventCount }] = await db
      .select({ eventCount: count() })
      .from(sipEventsTable)
      .where(eq(sipEventsTable.botId, botId));
    const [oldest] = await db
      .select()
      .from(sipEventsTable)
      .where(eq(sipEventsTable.botId, botId))
      .orderBy(sipEventsTable.timestamp)
      .limit(1);

    expect(eventCount).toBe(500);
    expect(oldest.summary).toBe("event-1");
  });
});