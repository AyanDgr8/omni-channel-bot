/**
 * MySQL has no `INSERT/UPDATE/DELETE ... RETURNING` clause (that is a
 * PostgreSQL extension), so writes cannot hand back the affected row.
 *
 * Every write that previously used `.returning()` is now a two-step:
 *
 *   const where = eq(botsTable.id, id);
 *   await db.update(botsTable).set(patch).where(where);
 *   const bot = await selectOne(botsTable, where);
 *
 * For DELETE the order flips — read the row first, then delete it.
 *
 * Note this is not atomic the way `RETURNING` was. Under a concurrent write to
 * the same row the value read back can be the newer one. Every caller in this
 * codebase writes rows keyed by a tenant-scoped id and only reads the result
 * back to echo it in the HTTP response, so the weaker guarantee is acceptable.
 */
import type { SQL } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { db } from "@workspace/db";

/** Read a single row back after a write. Returns undefined if it is gone. */
export async function selectOne<T extends MySqlTable>(
  table: T,
  where: SQL | undefined,
): Promise<T["$inferSelect"] | undefined> {
  const rows = await db.select().from(table).where(where).limit(1);
  return rows[0] as T["$inferSelect"] | undefined;
}

/**
 * Extract the row array from a raw `db.execute()` result.
 *
 * The drivers disagree on the shape: node-postgres returns `{ rows: [...] }`
 * whereas mysql2 returns the `[rows, fields]` tuple. Raw statements are only
 * used here for things Drizzle's query builder cannot express (`FOR UPDATE`,
 * `SKIP LOCKED`), so this keeps the unwrapping in one place.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
