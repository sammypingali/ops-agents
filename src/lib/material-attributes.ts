import { createAdminClient } from "@/lib/supabase/admin";

// Manual per-material report attributes (freight / within-target savings report).
// Keyed by `${tenkara_material_id}|${unit}` to line up with savings report lines.

export interface MaterialAttributes {
  moq: string | null;
  exw_cost: number | null;
  freight_ocean: number | null;
  freight_ocean_days: string | null;
  freight_air: number | null;
  freight_air_days: string | null;
  tariff_duty: number | null;
  facility_certs: string | null;
}

export const EMPTY_ATTRS: MaterialAttributes = {
  moq: null,
  exw_cost: null,
  freight_ocean: null,
  freight_ocean_days: null,
  freight_air: null,
  freight_air_days: null,
  tariff_duty: null,
  facility_certs: null,
};

export function attrKey(materialId: string, unit: string | null | undefined): string {
  return `${materialId}|${unit ?? ""}`;
}

export function hasAnyAttr(a: MaterialAttributes | null | undefined): boolean {
  if (!a) return false;
  return Object.values(a).some((v) => v != null && v !== "");
}

// Load all attribute rows for an org into a map keyed by material_id|unit.
export async function loadMaterialAttributes(orgId: string): Promise<Record<string, MaterialAttributes>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("material_attributes")
    .select("tenkara_material_id, unit, moq, exw_cost, freight_ocean, freight_ocean_days, freight_air, freight_air_days, tariff_duty, facility_certs")
    .eq("org_id", orgId);
  const out: Record<string, MaterialAttributes> = {};
  for (const r of data ?? []) {
    out[attrKey(r.tenkara_material_id, r.unit)] = {
      moq: r.moq ?? null,
      exw_cost: r.exw_cost != null ? Number(r.exw_cost) : null,
      freight_ocean: r.freight_ocean != null ? Number(r.freight_ocean) : null,
      freight_ocean_days: r.freight_ocean_days ?? null,
      freight_air: r.freight_air != null ? Number(r.freight_air) : null,
      freight_air_days: r.freight_air_days ?? null,
      tariff_duty: r.tariff_duty != null ? Number(r.tariff_duty) : null,
      facility_certs: r.facility_certs ?? null,
    };
  }
  return out;
}
