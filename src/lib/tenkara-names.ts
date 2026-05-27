import { tenkaraQuery } from "./tenkara-readonly";

// Resolve supplier and material UUIDs to display names by hitting Tenkara prod.
// Used by /work pages where rows reference IDs but humans need names. We cache
// per-request via the caller passing maps in; the pool itself is process-wide
// so repeated calls in a single Next.js render share connections.

export async function resolveSupplierNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return out;
  const rows = await tenkaraQuery<{ id: string; name: string }>(
    `select id::text as id, name from suppliers where id = any($1::uuid[])`,
    [unique]
  );
  for (const r of rows) out.set(r.id, r.name);
  return out;
}

export async function resolveMaterialNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return out;
  const rows = await tenkaraQuery<{ id: string; name: string }>(
    `select id::text as id, name from materials where id = any($1::uuid[])`,
    [unique]
  );
  for (const r of rows) out.set(r.id, r.name);
  return out;
}
