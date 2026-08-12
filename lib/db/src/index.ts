import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * Run all pending Drizzle SQL migrations from the given folder.
 * Call this once on server startup before opening the HTTP port.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  const migDb = drizzle(pool);
  await migrate(migDb, { migrationsFolder });
}

export * from "./schema";
