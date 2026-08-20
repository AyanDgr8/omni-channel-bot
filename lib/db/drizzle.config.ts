import { defineConfig } from "drizzle-kit";
import { resolveDbConfig } from "./src/config";

// Accepts either DATABASE_URL or the separate MYSQL_* variables.
const { host, port, user, password, database } = resolveDbConfig();

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "mysql",
  dbCredentials: { host, port, user, password, database },
  migrations: {
    table: "drizzle_migrations",
  },
});
