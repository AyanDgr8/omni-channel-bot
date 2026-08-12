import { pool } from "@workspace/db";
import { runMigrations } from "../lib/run-migrations.js";

// Apply pending DB migrations so test schemas are always up-to-date
beforeAll(async () => {
  await runMigrations();
});

// Ensure DB connection closes cleanly after all tests
afterAll(async () => {
  await pool.end();
});
