import { NextRequest, NextResponse } from "next/server";
import { getSession, hasAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { toCsv, filenameFor, type CsvCell } from "@/lib/csv";

// GET /api/exports/approvals?ids=uuid,uuid,uuid
// Server-side route (not under /api/agent — uses the logged-in session, not bearer auth).
// Generates a CSV of the selected approvals and flips their status approved -> ready_for_export.
// All actions audited.

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("unauthorized", { status: 401 });
  if (!hasAnyRole(session, ["admin", "ops_lead", "ops_operator"])) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) return new NextResponse("missing ids", { status: 400 });
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return new NextResponse("no ids", { status: 400 });

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("pending_approvals")
    .select("id, org_id, type, payload, requested_at, decided_at, decided_by, notes, status, orgs(slug, name)")
    .in("id", ids);
  if (error) return new NextResponse(error.message, { status: 500 });
  if (!rows || rows.length === 0) return new NextResponse("none found", { status: 404 });

  // All rows must belong to the same org (we generate one CSV per org).
  const orgSlugs = new Set((rows as any[]).map((r) => r.orgs?.slug ?? "unknown"));
  if (orgSlugs.size > 1) return new NextResponse("mixed-org export not supported", { status: 400 });
  const types = new Set((rows as any[]).map((r) => r.type));
  if (types.size > 1) return new NextResponse("mixed-type export not supported", { status: 400 });

  const orgSlug = (rows[0] as any).orgs?.slug ?? "unknown";
  const itemType = (rows[0] as any).type as string;

  // Build a permissive CSV — payload fields are flattened to top-level columns.
  const cols = collectColumns(rows as any[]);
  const csv = toCsv(cols, (rows as any[]).map((r) => cols.map((c) => extract(r, c) as CsvCell)));

  // Status transition: approved -> ready_for_export. Only rows that are currently 'approved'.
  const eligible = (rows as any[]).filter((r) => r.status === "approved").map((r) => r.id);
  if (eligible.length > 0) {
    await admin.from("pending_approvals").update({ status: "ready_for_export" }).in("id", eligible);
    await admin.from("audit_log").insert(
      eligible.map((id: string) => ({
        actor_user_id: session.userId,
        action: "approval.exported_pending_upload",
        target_table: "pending_approvals",
        target_id: id,
      }))
    );
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filenameFor(orgSlug, itemType)}"`,
      "cache-control": "no-store",
    },
  });
}

function collectColumns(rows: any[]): string[] {
  // Fixed columns first, then any payload keys discovered across rows.
  const fixed = ["id", "type", "requested_at", "decided_at", "notes"];
  const payloadKeys = new Set<string>();
  for (const r of rows) {
    if (r.payload && typeof r.payload === "object") {
      for (const k of Object.keys(r.payload)) payloadKeys.add(k);
    }
  }
  return [...fixed, ...Array.from(payloadKeys).sort()];
}

function extract(row: any, col: string): CsvCell {
  if (col in row) return row[col];
  return row.payload?.[col] ?? null;
}
