import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, calendarInvitesTable } from "@workspace/db";
import { selectOne } from "../lib/db-returning.js";
import {
  CreateCalendarInviteBody,
  GetAvailableSlotsQueryParams,
  GetAvailableSlotsResponse,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.post("/v1/calendar/invite", async (req, res): Promise<void> => {
  const parsed = CreateCalendarInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const id = randomUUID();
  await db
    .insert(calendarInvitesTable)
    .values({
      id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      start: new Date(parsed.data.start),
      end: new Date(parsed.data.end),
      timezone: parsed.data.timezone,
      attendees: parsed.data.attendees,
      location: parsed.data.location ?? null,
      callId: parsed.data.callId ?? null,
      calendarEventId: `cal_${randomUUID().split("-")[0]}`,
      tenantId: req.tenantId!,
    });
  const invite = await selectOne(calendarInvitesTable, eq(calendarInvitesTable.id, id));
  res.status(201).json(invite);
});

router.get("/v1/calendar/slots", async (req, res): Promise<void> => {
  const params = GetAvailableSlotsQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const date = new Date(params.data.date);
  const slots = [];
  for (let hour = 9; hour < 18; hour++) {
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(date);
    end.setHours(hour, 30, 0, 0);
    slots.push({ start: start.toISOString(), end: end.toISOString(), available: Math.random() > 0.3 });
    const start2 = new Date(date);
    start2.setHours(hour, 30, 0, 0);
    const end2 = new Date(date);
    end2.setHours(hour + 1, 0, 0, 0);
    slots.push({ start: start2.toISOString(), end: end2.toISOString(), available: Math.random() > 0.3 });
  }

  res.json(GetAvailableSlotsResponse.parse(slots));
});

export default router;
