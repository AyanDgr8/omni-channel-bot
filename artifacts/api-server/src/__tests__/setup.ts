import { pool } from "@workspace/db";

// Ensure DB connection closes cleanly after all tests
afterAll(async () => {
  await pool.end();
});
