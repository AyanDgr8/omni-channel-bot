import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./index";
import type { InsertSipEvent } from "./schema/sip";

const SIP_EVENT_RETENTION_LIMIT = 500;

/**
 * MySQL requires a LIMIT before OFFSET. This is the documented "all rows after
 * the offset" sentinel (2^64 - 1).
 */
const MYSQL_UNBOUNDED_LIMIT = "18446744073709551615";

export type NewSipEvent = Omit<InsertSipEvent, "id"> & {
  id?: string;
  timestamp?: Date;
};

/**
 * Insert one SIP event and atomically retain only the newest 500 events for
 * that bot.
 *
 * PostgreSQL did this with `pg_advisory_xact_lock` plus a single
 * `INSERT ... RETURNING` CTE. MySQL has neither, so instead:
 *
 *  - Writers for a bot are serialised by taking a `FOR UPDATE` row lock on the
 *    owning `bots` row. Unlike `GET_LOCK`, that lock is transaction-scoped, so
 *    it is released on commit/rollback and cannot leak across pooled
 *    connections.
 *  - The insert and the overflow delete are separate statements. They are
 *    still one atomic unit because both run inside the transaction, and the
 *    row lock means no concurrent writer for this bot can interleave.
 */
export async function insertSipEvent(event: NewSipEvent): Promise<void> {
  const id = event.id ?? randomUUID();
  const timestamp = event.timestamp ?? new Date();

  await db.transaction(async (tx) => {
    // Serialise concurrent writers for this bot for the rest of the transaction.
    await tx.execute(sql`SELECT 1 FROM bots WHERE id = ${event.botId} FOR UPDATE`);

    await tx.execute(sql`
      INSERT INTO sip_events (
        id, tenant_id, bot_id, timestamp, level, direction, method_response, summary, raw_snippet
      ) VALUES (
        ${id}, ${event.tenantId}, ${event.botId}, ${timestamp}, ${event.level ?? "info"},
        ${event.direction ?? null}, ${event.methodResponse ?? null}, ${event.summary},
        ${event.rawSnippet ?? null}
      )
    `);

    // MySQL rejects a subquery that reads the table being deleted (ER_UPDATE_TABLE_USED)
    // unless it is materialised through a derived table, hence the extra nesting.
    await tx.execute(sql`
      DELETE FROM sip_events
      WHERE id IN (
        SELECT id FROM (
          SELECT id FROM sip_events
          WHERE bot_id = ${event.botId}
          ORDER BY timestamp DESC, id DESC
          LIMIT ${sql.raw(MYSQL_UNBOUNDED_LIMIT)} OFFSET ${sql.raw(String(SIP_EVENT_RETENTION_LIMIT))}
        ) AS overflow
      )
    `);
  });
}

export { SIP_EVENT_RETENTION_LIMIT };
