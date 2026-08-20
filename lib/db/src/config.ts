/**
 * MySQL connection settings, resolved from the environment.
 *
 * Two forms are supported, checked in this order:
 *
 *  1. `DATABASE_URL` — a single URI, e.g.
 *       mysql://user:password@localhost:3306/voxagent
 *     This is what hosted environments (Replit, most PaaS) inject.
 *
 *  2. `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` /
 *     `MYSQL_DATABASE` — the settings as separate values.
 *
 * Form 2 exists because a URI requires percent-encoding any `@`, `:`, `/`, or
 * `#` in the password — a silent, easy-to-miss source of "Access denied".
 * Supplying the parts separately avoids the escaping question entirely, so
 * prefer it locally.
 */

export interface ResolvedDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DEFAULT_PORT = 3306;

function fromDatabaseUrl(raw: string): ResolvedDbConfig {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid URL. Expected the form " +
        "mysql://user:password@host:3306/database — note that special " +
        "characters in the password must be percent-encoded (@ becomes %40).",
    );
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("DATABASE_URL is missing a database name (the path after the host).");
  }

  return {
    host: decodeURIComponent(url.hostname),
    port: url.port ? Number(url.port) : DEFAULT_PORT,
    // URL components arrive percent-encoded; mysql2 wants the raw values.
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

function fromMysqlParts(): ResolvedDbConfig | null {
  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const database = process.env.MYSQL_DATABASE;

  if (!host || !user || !database) return null;

  const rawPort = process.env.MYSQL_PORT;
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid MYSQL_PORT value: "${rawPort}"`);
  }

  return {
    host,
    port,
    user,
    password: process.env.MYSQL_PASSWORD ?? "",
    database,
  };
}

export function resolveDbConfig(): ResolvedDbConfig {
  const url = process.env.DATABASE_URL;
  if (url) return fromDatabaseUrl(url);

  const parts = fromMysqlParts();
  if (parts) return parts;

  throw new Error(
    "No database configuration found. Set either DATABASE_URL " +
      "(mysql://user:password@host:3306/database) or the separate " +
      "MYSQL_HOST / MYSQL_USER / MYSQL_DATABASE variables " +
      "(plus optional MYSQL_PASSWORD and MYSQL_PORT).",
  );
}
