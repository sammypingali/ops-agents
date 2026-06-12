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

// Inbox — the single cross-client surface. Priority work across the clients an
// operator is assigned to. Stage 1: surfaces staged drafts (assigned + unclaimed);
// later stages fold in replies, escalations, approvals, price alerts, revalidations.
export default async function InboxPage() {
  const session = (await getSession())!;
  const admin = createAdminClient();
  const orgIds = await getAssignedOrgIds(session); // null = sees all clients
  const scope = (q: any) => (orgIds ? q.in("org_id", orgIds) : q);

  const { data: assignedDrafts } = await admin
    .from("draft_references")
    .select("id, subject, supplier_id, material_id, status, created_at, org_id, orgs(slug, name)")
    .eq("assigned_operator", session.userId)
    .eq("status", "staged")
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: unassignedDrafts } = await scope(
    admin
      .from("draft_references")
      .select("id, subject, supplier_id, material_id, status, created_at, org_id, orgs(slug, name)")
      .is("assigned_operator", null)
      .eq("status", "staged")
      .order("created_at", { ascending: false })
      .limit(15)
  );

  const allDrafts = [...(assignedDrafts ?? []), ...(unassignedDrafts ?? [])];
  const supplierIds = allDrafts.map((d: any) => d.supplier_id).filter(Boolean);
  const materialIds = allDrafts.map((d: any) => d.material_id).filter(Boolean);
  let supplierNames = new Map<string, string>();
  let materialNames = new Map<string, string>();
  try {
    [supplierNames, materialNames] = await Promise.all([
      resolveSupplierNamesWithFallback(supplierIds),
      resolveMaterialNames(materialIds),
    ]);
  } catch {
    /* fall back to ids if Tenkara is unreachable */
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = session.displayName?.split(" ")[0] ?? null;
  const primaryRoleLabel = session.roles.length ? roleLabel(session.roles[0]) : "Operator";
  const scopeLabel = seesAllOrgs(session)
    ? "all clients"
    : `${orgIds?.length ?? 0} client${(orgIds?.length ?? 0) === 1 ? "" : "s"}`;

  return (
    <div className="space-y-8 max-w-6xl">
      <header>
        <h1 className="font-serif text-4xl tracking-tight">
          {greeting}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">Priority work across your clients.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Signed in as <span className="font-medium text-foreground">{primaryRoleLabel}</span> · covering {scopeLabel}.
        </p>
      </header>

      <PageExplainer tag="Your inbox.">
        The one cross-client surface. Everything else in Control Room is scoped to a single client. Agents stage work here for
        review — nothing sends until you click Send in Missive.
      </PageExplainer>

      <Card className="tb-surface shadow-none">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-medium">
            Assigned to you <span className="ml-1 text-foreground">· {assignedDrafts?.length ?? 0}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assignedDrafts && assignedDrafts.length > 0 ? (
            <DraftTable rows={assignedDrafts as any} supplierNames={supplierNames} materialNames={materialNames} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing assigned to you right now.</p>
          )}
        </CardContent>
      </Card>

      <Card className="tb-surface shadow-none">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-medium">
            Unclaimed in your clients <span className="ml-1 text-foreground">· {unassignedDrafts?.length ?? 0}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unassignedDrafts && unassignedDrafts.length > 0 ? (
            <DraftTable rows={unassignedDrafts as any} supplierNames={supplierNames} materialNames={materialNames} />
          ) : (
            <p className="text-sm text-muted-foreground">Inbox zero — nothing waiting for pickup.</p>
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
