import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";
import { MarketplaceFindingActions } from "@/components/marketplace-finding-actions";
import { getSession, hasAnyRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OrgPriceChangesPage({ params }: { params: { slug: string } }) {
  const session = (await getSession())!;
  const admin = createAdminClient();
  const { data: org } = await admin.from("orgs").select("id, slug, name").eq("slug", params.slug).maybeSingle();
  if (!org) notFound();

  const { data: rows } = await admin
    .from("marketplace_check_findings")
    .select("id, supplier_name, material_name, baseline_price, current_price, currency, pct_change, status, source_url, created_at")
    .eq("org_id", org.id)
    .eq("status", "pending_review")
    .order("pct_change", { ascending: false, nullsFirst: false })
    .limit(200);
  const findings = rows ?? [];
  const canAct = hasAnyRole(session, ["admin", "ops_lead", "ops_operator"]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marketplace price changes Agent 05 flagged for {org.name}. Approve the ones worth applying, then update the Tenkara platform manually.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead>Material</TableHead>
            <TableHead className="text-right">Old</TableHead>
            <TableHead className="text-right">New</TableHead>
            <TableHead className="text-right">Δ%</TableHead>
            <TableHead>Checked</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {findings.map((r: any) => {
            const sym = r.currency === "USD" || !r.currency ? "$" : "";
            const pct = r.pct_change != null ? `${Number(r.pct_change) > 0 ? "+" : ""}${Number(r.pct_change).toFixed(1)}%` : "—";
            return (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.supplier_name}</TableCell>
                <TableCell>{r.material_name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.baseline_price != null ? `${sym}${Number(r.baseline_price).toFixed(2)}` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.current_price != null ? `${sym}${Number(r.current_price).toFixed(2)}` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{pct}</TableCell>
                <TableCell className="text-muted-foreground">{relativeTime(r.created_at)}</TableCell>
                <TableCell className="text-right"><MarketplaceFindingActions findingId={r.id} status={r.status} disabled={!canAct} /></TableCell>
              </TableRow>
            );
          })}
          {findings.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No price changes pending review.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
