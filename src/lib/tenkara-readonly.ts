import { Pool, type PoolClient } from "pg";

// Single read-only client to the Tenkara prod Supabase. Reuses a pool across
// invocations; idle connections close after 30s. The connection string is the
// `mcp_readonly` role connection from the tenkara-supabase-setup skill — this
// is enforced by checking the username on init. Anyone passing a service-role
// or owner connection string by accident gets an immediate throw.

const REQUIRED_USERNAME_PREFIX = "mcp_readonly.";

let pool: Pool | null = null;

function buildPool(): Pool {
  const url = process.env.TENKARA_READONLY_DATABASE_URL;
  if (!url) {
    throw new Error("TENKARA_READONLY_DATABASE_URL is not set. Add the mcp_readonly connection string from the tenkara-supabase-setup skill.");
  }
  // Validate the role embedded in the URL.
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("TENKARA_READONLY_DATABASE_URL is not a valid URL"); }
  if (!parsed.username || !parsed.username.startsWith(REQUIRED_USERNAME_PREFIX)) {
    throw new Error(
      `TENKARA_READONLY_DATABASE_URL must use the mcp_readonly role (username starts with "${REQUIRED_USERNAME_PREFIX}"); ` +
      `got "${parsed.username}". Refusing to connect to avoid accidental writes.`
    );
  }
  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
}

export async function tenkaraQuery<T extends Record<string, any> = Record<string, any>>(text: string, params: any[] = []): Promise<T[]> {
  if (!pool) pool = buildPool();
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

// Convenience: run a callback with a pinned client (e.g., for transactions, but
// we should never write to Tenkara so transactions aren't really used).
export async function withTenkaraClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) pool = buildPool();
  const client = await pool.connect();
  try { return await fn(client); } finally { client.release(); }
}
