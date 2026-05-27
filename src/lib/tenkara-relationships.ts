import { tenkaraQuery } from "./tenkara-readonly";

// A supplier has a "prior relationship" with an org if Tenkara holds any
// material_quotes row tying that supplier to a material owned by a user in
// that organization. We use this to suppress the initial-outreach RFQ —
// suppliers we've already worked with shouldn't receive a cold first email.

export async function hasPriorRelationship(
  supplierTenkaraId: string,
  orgTenkaraId: string
): Promise<boolean> {
  const rows = await tenkaraQuery<{ exists: boolean }>(
    `select exists(
       select 1
         from public.material_quotes q
         join public.materials m on m.id = q.material_id
         join public.users u on u.id = m.user_id
        where q.supplier_id = $1::uuid
          and u.organization_id = $2::uuid
     ) as exists`,
    [supplierTenkaraId, orgTenkaraId]
  );
  return rows[0]?.exists === true;
}

// Batched variant — one round-trip for many pairs. Returns the set of supplier
// IDs that already have a relationship with `orgTenkaraId`.
export async function suppliersWithPriorRelationship(
  supplierTenkaraIds: string[],
  orgTenkaraId: string
): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = Array.from(new Set(supplierTenkaraIds.filter(Boolean)));
  if (unique.length === 0 || !orgTenkaraId) return out;
  const rows = await tenkaraQuery<{ supplier_id: string }>(
    `select distinct q.supplier_id::text as supplier_id
       from public.material_quotes q
       join public.materials m on m.id = q.material_id
       join public.users u on u.id = m.user_id
      where q.supplier_id = any($1::uuid[])
        and u.organization_id = $2::uuid`,
    [unique, orgTenkaraId]
  );
  for (const r of rows) out.add(r.supplier_id);
  return out;
}
