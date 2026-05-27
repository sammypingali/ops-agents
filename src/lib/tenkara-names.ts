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

// Tenkara's material_quotes table has no quote-number field. Build a human
// label from price/UOM + date so an operator can tell quotes apart on sight.
export async function resolveQuoteRefs(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return out;
  const rows = await tenkaraQuery<{ id: string; price: number | null; uom: string | null; quote_date: string | null }>(
    `select id::text as id, price, unit_of_measurement as uom, quote_date::text as quote_date
       from material_quotes where id = any($1::uuid[])`,
    [unique]
  );
  for (const r of rows) {
    const parts: string[] = [];
    if (r.price != null) parts.push(`$${Number(r.price).toFixed(2)}${r.uom ? `/${r.uom}` : ""}`);
    if (r.quote_date) parts.push(new Date(r.quote_date).toLocaleDateString());
    out.set(r.id, parts.length ? parts.join(" · ") : r.id);
  }
  return out;
}
