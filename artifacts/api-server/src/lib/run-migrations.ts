/**
 * Thin wrapper that resolves the migrations folder path and delegates to
 * @workspace/db's runMigrations().
 *
 * – Production (esbuild bundle): the build banner sets __dirname to the dist/
 *   directory; build.mjs copies lib/db/src/migrations → dist/migrations.
 * – Development (tsx): __dirname is the real source file directory so we
 *   navigate up four levels to the workspace root then into lib/db/src/migrations.
 */
import path from "path";
import { runMigrations as _run } from "@workspace/db";
import { logger } from "./logger.js";

function getMigrationsFolder(): string {
  if (__dirname.includes("/dist")) {
    // Production bundle: migrations were copied next to the entry point
    return path.join(__dirname, "migrations");
  }
  // Development: __dirname = artifacts/api-server/src/lib
  // → ../../../../ = workspace root → lib/db/src/migrations
  return path.resolve(__dirname, "../../../../lib/db/src/migrations");
}

export async function runMigrations(): Promise<void> {
  const migrationsFolder = getMigrationsFolder();
  logger.info({ migrationsFolder }, "Running pending DB migrations");
  await _run(migrationsFolder);
  logger.info("DB migrations complete");
}
