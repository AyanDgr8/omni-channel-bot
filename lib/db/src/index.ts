import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import type { PoolConnection as CallbackPoolConnection } from "mysql2";
import * as schema from "./schema";
import { resolveDbConfig } from "./config";

/**
 * MySQL connection pool.
 *
 * Connection settings come from `DATABASE_URL`, or from the separate
 * `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` /
 * `MYSQL_DATABASE` variables — see ./config.ts.
 *
 * Notes:
 *  - `supportBigNumbers`/`bigNumberStrings` keep BIGINT values exact.
 *  - `multipleStatements` is required so Drizzle can apply migration files
 *    that contain more than one statement per breakpoint.
 *  - `timezone: "Z"` makes mysql2 read and write DATETIME/TIMESTAMP values as
 *    UTC, matching the `timestamp with time zone` semantics this schema used
 *    on PostgreSQL.
 */
export const pool: mysql.Pool = mysql.createPool({
  ...resolveDbConfig(),
  connectionLimit: 10,
  supportBigNumbers: true,
  bigNumberStrings: false,
  timezone: "Z",
  multipleStatements: true,
});

/**
 * Force every pooled connection to UTC.
 *
 * MySQL evaluates `CURRENT_TIMESTAMP` (the DDL default behind every
 * `.defaultNow()` column) in the *session* time zone, which defaults to the
 * server's local zone. The `timezone: "Z"` option above only tells mysql2 how
 * to parse the value that comes back — it does not change how MySQL generates
 * it. Without this, rows written by a DB-side default land in the database as
 * local time and are then read back as if they were UTC, skewing every
 * `created_at`/`updated_at` by the server's UTC offset.
 *
 * Queries are serialised per connection, so this runs before any application
 * query on the same connection.
 */
pool.on("connection", (connection) => {
  // Despite this being a mysql2/promise pool, the event hands out the
  // underlying callback-API connection, so use the callback form here.
  (connection as unknown as CallbackPoolConnection).query(
    "SET time_zone = '+00:00'",
    (err) => {
      if (err) console.error("Failed to set session time zone to UTC:", err);
    },
  );
});

export const db = drizzle(pool, { schema, mode: "default" });

/**
 * Run all pending Drizzle SQL migrations from the given folder.
 * Call this once on server startup before opening the HTTP port.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  const migDb = drizzle(pool, { mode: "default" });
  await migrate(migDb, { migrationsFolder });
}

export * from "./schema";
