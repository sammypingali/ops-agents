import { NextResponse } from "next/server";
import { getSession, hasAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAssignedOrgIds } from "@/lib/org-access";
import { toCsv } from "@/lib/csv";
import { QUOTE_EXPORT_HEADERS } from "@/lib/tenkara-templates";

// GET /api/staged-quotes/export-csv
// Streams a Tenkara-ready CSV of all approved staged_quotes the caller can see.
// Only real Tenkara material_quotes columns are emitted (no ops-only fields like
// unit_price/source/approved_at, which shifted data into the wrong columns on
// upload). Ops downloads this and uploads it via Tenkara's bulk-upload path —
// staged quotes never write back automatically.

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("unauthorized", { status: 401 });
  if (!hasAnyRole(session, ["admin", "ops_lead", "ops_operator"])) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const admin = createAdminClient();
  const assigned = await getAssignedOrgIds(session);

  let q = admin
    .from("staged_quotes")
    .select("supplier_id, supplier_name, material_id, material_name, price, case_size, unit_of_measurement")
    .eq("status", "approved")
    .order("approved_at", { ascending: false });
  if (assigned) q = q.in("org_id", assigned);

  const { data: rows, error } = await q;
  if (error) return new NextResponse(error.message, { status: 500 });

  const body = toCsv(
    [...QUOTE_EXPORT_HEADERS],
    (rows ?? []).map((r: any) => [
      r.supplier_id,
      r.supplier_name,
      r.material_id,
      r.material_name,
      r.price,
      r.case_size,
      r.unit_of_measurement,
    ])
  );

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tenkara-quotes-${date}.csv"`,
    },
  });
}
