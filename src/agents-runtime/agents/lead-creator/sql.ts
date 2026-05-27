import { tenkaraQuery } from "@/lib/tenkara-readonly";

// Tenkara prod schema (confirmed via mcp_readonly):
//   materials(id, name, trade_name, inci, created_at, user_id, ...)
//   suppliers(id, name, website, poc_name, poc_email, country, ...)
//   material_quotes(id, material_id, supplier_id, created_at, status, ...)
//   supplier_catalog_materials(supplier_id, product_name, trade_name, inci, cas_number, ...)
//
// Agent 03 reads ONLY from Tenkara via mcp_readonly. No writes touch this DB.

export interface MaterialRow {
  id: string;
  name: string | null;
  trade_name: string | null;
  inci: string | null;
  created_at: string;
  user_id: string | null;
}

export interface CandidateSupplier {
  supplier_id: string;
  supplier_name: string;
  supplier_website: string | null;
  supplier_poc_name: string | null;
  supplier_poc_email: string | null;
  supplier_country: string | null;
  // How we found them — drives `source` and `confidence_score` downstream.
  signal: "quoted_same_material" | "quoted_similar_inci" | "quoted_similar_name" | "catalog_match";
  signal_count: number;
}

// Materials added since `since` (ISO). Spec says last 4h on cron; pass since
// explicitly so manual triggers can backfill.
export async function queryRecentMaterials(since: string): Promise<MaterialRow[]> {
  return tenkaraQuery<MaterialRow>(
    `select id, name, trade_name, inci, created_at, user_id
       from public.materials
      where created_at >= $1::timestamptz
      order by created_at desc
      limit 200`,
    [since]
  );
}

// Top suppliers who have quoted this exact material, then suppliers who have
// quoted other materials with matching INCI or name, then suppliers carrying
// the material in their uploaded catalog. We union the three buckets in JS
// (with signal labels) so Agent 03 can score and dedupe.
export async function findCandidatesForMaterial(material: MaterialRow): Promise<CandidateSupplier[]> {
  const candidates: CandidateSupplier[] = [];

  // 1. Suppliers who have quoted this exact material_id.
  const exact = await tenkaraQuery<CandidateSupplier>(
    `select s.id as supplier_id,
            s.name as supplier_name,
            s.website as supplier_website,
            s.poc_name as supplier_poc_name,
            s.poc_email as supplier_poc_email,
            s.country as supplier_country,
            'quoted_same_material'::text as signal,
            count(q.id)::int as signal_count
       from public.material_quotes q
       join public.suppliers s on s.id = q.supplier_id
      where q.material_id = $1
      group by s.id, s.name, s.website, s.poc_name, s.poc_email, s.country
      order by count(q.id) desc
      limit 5`,
    [material.id]
  );
  candidates.push(...exact);

  // 2. Suppliers who have quoted materials with matching INCI.
  if (material.inci) {
    const sameInci = await tenkaraQuery<CandidateSupplier>(
      `select s.id as supplier_id,
              s.name as supplier_name,
              s.website as supplier_website,
              s.poc_name as supplier_poc_name,
              s.poc_email as supplier_poc_email,
              s.country as supplier_country,
              'quoted_similar_inci'::text as signal,
              count(q.id)::int as signal_count
         from public.material_quotes q
         join public.suppliers s on s.id = q.supplier_id
         join public.materials  m2 on m2.id = q.material_id
        where m2.id <> $1
          and m2.inci is not null
          and lower(m2.inci) = lower($2)
        group by s.id, s.name, s.website, s.poc_name, s.poc_email, s.country
        order by count(q.id) desc
        limit 5`,
      [material.id, material.inci]
    );
    candidates.push(...sameInci);
  }

  // 3. Suppliers who have quoted materials with matching name (case-insensitive).
  const nameKey = material.trade_name ?? material.name;
  if (nameKey) {
    const sameName = await tenkaraQuery<CandidateSupplier>(
      `select s.id as supplier_id,
              s.name as supplier_name,
              s.website as supplier_website,
              s.poc_name as supplier_poc_name,
              s.poc_email as supplier_poc_email,
              s.country as supplier_country,
              'quoted_similar_name'::text as signal,
              count(q.id)::int as signal_count
         from public.material_quotes q
         join public.suppliers s on s.id = q.supplier_id
         join public.materials  m2 on m2.id = q.material_id
        where m2.id <> $1
          and (lower(coalesce(m2.trade_name,'')) = lower($2) or lower(coalesce(m2.name,'')) = lower($2))
        group by s.id, s.name, s.website, s.poc_name, s.poc_email, s.country
        order by count(q.id) desc
        limit 5`,
      [material.id, nameKey]
    );
    candidates.push(...sameName);
  }

  // 4. Suppliers with this material (by INCI/name) in their uploaded catalog.
  if (material.inci || nameKey) {
    const catalog = await tenkaraQuery<CandidateSupplier>(
      `select s.id as supplier_id,
              s.name as supplier_name,
              s.website as supplier_website,
              s.poc_name as supplier_poc_name,
              s.poc_email as supplier_poc_email,
              s.country as supplier_country,
              'catalog_match'::text as signal,
              count(scm.id)::int as signal_count
         from public.supplier_catalog_materials scm
         join public.suppliers s on s.id = scm.supplier_id
        where ($1::text is not null and lower(scm.inci) = lower($1::text))
           or ($2::text is not null and (
               lower(coalesce(scm.product_name,'')) = lower($2::text)
            or lower(coalesce(scm.trade_name,''))   = lower($2::text)
           ))
        group by s.id, s.name, s.website, s.poc_name, s.poc_email, s.country
        order by count(scm.id) desc
        limit 5`,
      [material.inci, nameKey]
    );
    candidates.push(...catalog);
  }

  return candidates;
}
