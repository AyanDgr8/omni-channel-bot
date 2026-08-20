import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, flowConfigsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { selectOne } from "../lib/db-returning.js";
import { requireRole } from "../middleware/require-role.js";
import { auditMiddleware } from "../middleware/audit.js";

const router: IRouter = Router();

const DEFAULT_FLOW = {
  nodes: [
    { id: "start-1", type: "start", position: { x: 340, y: 40 }, data: { label: "Call Begins" } },
    { id: "greet-1", type: "botSays", position: { x: 240, y: 160 }, data: { label: "Greeting", text: "Hello! Thank you for calling. How can I help you today?" } },
    { id: "ask-1", type: "askQuestion", position: { x: 240, y: 310 }, data: { label: "Intent Detection", question: "What can I help you with?", keywords: ["appointment", "billing", "support", "cancel"] } },
    { id: "cond-1", type: "condition", position: { x: 100, y: 460 }, data: { label: "Billing?", condition: "Contains: billing OR payment OR invoice" } },
    { id: "cond-2", type: "condition", position: { x: 380, y: 460 }, data: { label: "Appointment?", condition: "Contains: appointment OR schedule OR book" } },
    { id: "resp-1", type: "botSays", position: { x: 20, y: 610 }, data: { label: "Billing Info", text: "I can help with billing. Your last payment was received successfully. Would you like a summary?" } },
    { id: "sched-1", type: "schedule", position: { x: 360, y: 610 }, data: { label: "Book Appointment", description: "Schedule a callback with our team" } },
    { id: "transfer-1", type: "transfer", position: { x: 620, y: 460 }, data: { label: "Transfer to Agent", target: "1000", targetType: "extension" } },
    { id: "end-1", type: "end", position: { x: 80, y: 760 }, data: { label: "End Call" } },
    { id: "end-2", type: "end", position: { x: 400, y: 760 }, data: { label: "End Call" } },
  ],
  edges: [
    { id: "e1", source: "start-1", target: "greet-1", animated: true },
    { id: "e2", source: "greet-1", target: "ask-1" },
    { id: "e3", source: "ask-1", target: "cond-1", label: "billing" },
    { id: "e4", source: "ask-1", target: "cond-2", label: "appointment" },
    { id: "e5", source: "ask-1", target: "transfer-1", label: "other" },
    { id: "e6", source: "cond-1", target: "resp-1", label: "Yes" },
    { id: "e7", source: "cond-2", target: "sched-1", label: "Yes" },
    { id: "e8", source: "resp-1", target: "end-1" },
    { id: "e9", source: "sched-1", target: "end-2" },
  ],
};

router.get("/v1/flow/configs", async (req, res): Promise<void> => {
  const configs = await db
    .select()
    .from(flowConfigsTable)
    .where(eq(flowConfigsTable.tenantId, req.tenantId!))
    .orderBy(flowConfigsTable.updatedAt);
  res.json(configs);
});

router.post("/v1/flow/configs", requireRole("ADMIN"), auditMiddleware("flow"), async (req, res): Promise<void> => {
  const { name, description, definition } = req.body as { name?: string; description?: string; definition?: unknown };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const id = randomUUID();
  await db.insert(flowConfigsTable).values({
    id,
    name,
    description: description ?? null,
    definition: (definition ?? DEFAULT_FLOW) as typeof flowConfigsTable.$inferInsert["definition"],
    tenantId: req.tenantId!,
  });
  const config = await selectOne(flowConfigsTable, eq(flowConfigsTable.id, id));
  res.status(201).json(config);
});

router.get("/v1/flow/configs/:id", async (req, res): Promise<void> => {
  const id = req.params.id as string;
  const [config] = await db
    .select()
    .from(flowConfigsTable)
    .where(and(eq(flowConfigsTable.id, id), eq(flowConfigsTable.tenantId, req.tenantId!)));
  if (!config) { res.status(404).json({ error: "Flow not found" }); return; }
  res.json(config);
});

router.put("/v1/flow/configs/:id", requireRole("ADMIN"), auditMiddleware("flow"), async (req, res): Promise<void> => {
  const id = req.params.id as string;
  const { name, description, definition } = req.body as { name?: string; description?: string; definition?: unknown };
  const scope = and(eq(flowConfigsTable.id, id), eq(flowConfigsTable.tenantId, req.tenantId!));
  await db
    .update(flowConfigsTable)
    .set({
      ...(name ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(definition ? { definition: definition as typeof flowConfigsTable.$inferInsert["definition"] } : {}),
      updatedAt: new Date(),
    })
    .where(scope);
  const config = await selectOne(flowConfigsTable, scope);
  if (!config) { res.status(404).json({ error: "Flow not found" }); return; }
  res.json(config);
});

router.delete("/v1/flow/configs/:id", requireRole("ADMIN"), auditMiddleware("flow"), async (req, res): Promise<void> => {
  const id = req.params.id as string;
  // MySQL has no DELETE ... RETURNING — read the row first, then remove it.
  const scope = and(eq(flowConfigsTable.id, id), eq(flowConfigsTable.tenantId, req.tenantId!));
  const config = await selectOne(flowConfigsTable, scope);
  if (config) await db.delete(flowConfigsTable).where(scope);
  if (!config) { res.status(404).json({ error: "Flow not found" }); return; }
  res.sendStatus(204);
});

export default router;
