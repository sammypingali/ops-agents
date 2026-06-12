import Link from "next/link";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";
import { resolveSupplierNamesWithFallback, resolveMaterialNames } from "@/lib/tenkara-names";
import { PageExplainer } from "@/components/page-explainer";
import { roleLabel } from "@/lib/roles";
import { seesAllOrgs, getAssignedOrgIds } from "@/lib/org-access";

export const dynamic = "force-dynamic";

// Home — the cross-client dashboard. A prioritized roll-up of "where do I start?"
// across the operator's clients, linking into each client's Queue for the full
// list. NOT a flat inbox (that duplicated the per-client Queue). Stage 1 shows
// the one real cross-client signal we have (staged drafts to review) + the
// attention tiles/sections that fill in once exercises + queue data land.
export default async function HomePage() {
  const session = (await getSession())!;
  const admin = createAdminClient();
  const orgIds = await getAssignedOrgIds(session); // null = sees all
  const scope = (q: any) => (orgIds ? q.in("org_id", orgIds) : q);

  const { data: assignedDrafts } = await admin
    .from("draft_references")
    .select("id, subject, supplier_id, material_id, status, created_at, org_id, orgs(slug, name)")
    .eq("assigned_operator", session.userId)
    .eq("status", "staged")
    .order("created_at", { ascending: false })
    .limit(12);

  const { data: unassignedDrafts } = await scope(
    admin
      .from("draft_references")
      .select("id, subject, supplier_id, material_id, status, created_at, org_id, orgs(slug, name)")
      .is("assigned_operator", null)
      .eq("status", "staged")
      .order("created_at", { ascending: false })
      .limit(8)
  );

  const allDrafts = [...(assignedDrafts ?? []), ...(unassignedDrafts ?? [])];
  let supplierNames = new Map<string, string>();
  let materialNames = new Map<string, string>();
  try {
    [supplierNames, materialNames] = await Promise.all([
      resolveSupplierNamesWithFallback(allDrafts.map((d: any) => d.supplier_id).filter(Boolean)),
      resolveMaterialNames(allDrafts.map((d: any) => d.material_id).filter(Boolean)),
    ]);
  } catch {
    /* fall back to ids */
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = session.displayName?.split(" ")[0] ?? null;
  const primaryRoleLabel = session.roles.length ? roleLabel(session.roles[0]) : "Operator";
  const scopeLabel = seesAllOrgs(session)
    ? "all clients"
    : `${orgIds?.length ?? 0} client${(orgIds?.length ?? 0) === 1 ? "" : "s"}`;

  const tiles = [
    { label: "Exercises active", value: "—" },
    { label: "Responses pending", value: "—" },
    { label: "Approvals waiting", value: "—" },
    { label: "Quotes expiring", value: "—" },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      <header>
        <h1 className="font-serif text-4xl tracking-tight">
          {greeting}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">Where to start today, across your clients.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Signed in as <span className="font-medium text-foreground">{primaryRoleLabel}</span> · covering {scopeLabel}.
        </p>
      </header>

      {/* Attention tiles — populate once exercises + queue data land (Stage 2/3). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <Card key={t.label} className="tb-surface shadow-none">
            <CardContent className="py-5">
              <div className="text-2xl font-serif">{t.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{t.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <PageExplainer tag="Home.">
        A prioritized roll-up across your clients — attention items link straight into the relevant client&apos;s Queue. The full
        actionable list for any one client lives in that client&apos;s Queue tab.
      </PageExplainer>

      <Card className="tb-surface shadow-none">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-medium">
            Drafts to review <span className="ml-1 text-foreground">· {assignedDrafts?.length ?? 0} assigned</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assignedDrafts && assignedDrafts.length > 0 ? (
            <DraftTable rows={assignedDrafts as any} supplierNames={supplierNames} materialNames={materialNames} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing assigned to you right now.</p>
          )}
          {unassignedDrafts && unassignedDrafts.length > 0 && (
            <div className="mt-5">
              <div className="text-xs text-muted-foreground mb-2">Unclaimed in your clients · {unassignedDrafts.length}</div>
              <DraftTable rows={unassignedDrafts as any} supplierNames={supplierNames} materialNames={materialNames} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DraftTable({
  rows,
  supplierNames,
  materialNames,
}: {
  rows: any[];
  supplierNames: Map<string, string>;
  materialNames: Map<string, string>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead>Material</TableHead>
          <TableHead>Staged</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => {
          const supplierName = d.supplier_id ? supplierNames.get(d.supplier_id) : null;
          const materialName = d.material_id ? materialNames.get(d.material_id) : null;
          return (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.subject ?? "(no subject)"}</TableCell>
              <TableCell>{d.orgs?.name ?? "—"}</TableCell>
              <TableCell title={d.supplier_id ?? undefined}>
                {supplierName ?? (d.supplier_id ? <code className="text-xs text-muted-foreground">{d.supplier_id.slice(0, 8)}…</code> : "—")}
              </TableCell>
              <TableCell title={d.material_id ?? undefined}>
                {materialName ?? (d.material_id ? <code className="text-xs text-muted-foreground">{d.material_id.slice(0, 8)}…</code> : "—")}
              </TableCell>
              <TableCell className="text-muted-foreground">{relativeTime(d.created_at)}</TableCell>
              <TableCell><Link href={`/work/drafts/${d.id}`} className="text-primary hover:underline text-sm">Review →</Link></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
