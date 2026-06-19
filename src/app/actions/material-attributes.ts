"use server";

import { getSession, hasAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MaterialAttributes } from "@/lib/material-attributes";
import { revalidatePath } from "next/cache";

interface Result { ok: boolean; error?: string }

const EDIT_ROLES = ["admin", "ops_lead", "ops_operator"] as const;

// Upsert the manual freight/within-target attributes for one material line.
export async function saveMaterialAttributes(
  orgId: string,
  tenkaraMaterialId: string,
  unit: string,
  attrs: MaterialAttributes
): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (!hasAnyRole(session, [...EDIT_ROLES])) return { ok: false, error: "forbidden" };
  if (!tenkaraMaterialId) return { ok: false, error: "missing material" };

  const num = (v: number | null) => (v == null || Number.isNaN(v) ? null : v);
  const str = (v: string | null) => {
    const t = (v ?? "").trim();
    return t.length ? t.slice(0, 300) : null;
  };

  const admin = createAdminClient();
  const { error } = await admin.from("material_attributes").upsert(
    {
      org_id: orgId,
      tenkara_material_id: tenkaraMaterialId,
      unit: unit ?? "",
      moq: str(attrs.moq),
      exw_cost: num(attrs.exw_cost),
      freight_ocean: num(attrs.freight_ocean),
      freight_ocean_days: str(attrs.freight_ocean_days),
      freight_air: num(attrs.freight_air),
      freight_air_days: str(attrs.freight_air_days),
      tariff_duty: num(attrs.tariff_duty),
      facility_certs: str(attrs.facility_certs),
      updated_by: session.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,tenkara_material_id,unit" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/work/orgs/[slug]/savings`, "page");
  return { ok: true };
}
