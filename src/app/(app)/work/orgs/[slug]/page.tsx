import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notFound } from "next/navigation";
import { OperatorChip } from "@/components/operator-chip";
import { operatorRoles, primaryRole } from "@/lib/operator";

export const dynamic = "force-dynamic";

export default async function OrgOverview({ params }: { params: { slug: string } }) {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("orgs")
    .select("id, slug, name, tenkara_org_id, is_internal")
    .eq("slug", params.slug)
    .maybeSingle();
  if (!org) notFound();

  const [draftsRes, casesRes, approvalsRes, opsRes] = await Promise.all([
    admin.from("draft_references").select("id, status").eq("org_id", org.id),
    admin.from("cases").select("id, status").eq("org_id", org.id).eq("status", "open"),
    admin.from("pending_approvals").select("id").eq("org_id", org.id).eq("status", "pending"),
    admin
      .from("org_default_operators")
      .select("primary_user_id, backup_user_id, primary_user:users!org_default_operators_primary_user_id_fkey(display_name, email, status, user_roles(role)), backup_user:users!org_default_operators_backup_user_id_fkey(display_name, email, status, user_roles(role))")
      .eq("org_id", org.id)
      .maybeSingle(),
  ]);

  const drafts = draftsRes.data ?? [];
  const staged = drafts.filter((d: any) => d.status === "staged").length;
  const reviewed = drafts.filter((d: any) => d.status === "reviewed").length;
  const ops = opsRes.data as any;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric label="Drafts in flight" value={staged} note={`${reviewed} reviewed, awaiting send`} />
        <Metric label="Open cases" value={casesRes.data?.length ?? 0} />
        <Metric label="Pending approvals" value={approvalsRes.data?.length ?? 0} />
      </div>

      <Card className="tb-surface shadow-none">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-medium">Operator assignment</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {ops ? (
            <>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground w-20">Primary</span>
                <OperatorChip name={ops.primary_user?.display_name} email={ops.primary_user?.email} role={primaryRole(operatorRoles(ops.primary_user))} />
                {ops.primary_user?.status === "out_of_office" && <Badge variant="warn">OOO</Badge>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground w-20">Backup</span>
                {ops.backup_user_id ? (
                  <OperatorChip name={ops.backup_user?.display_name} email={ops.backup_user?.email} role={primaryRole(operatorRoles(ops.backup_user))} />
                ) : (
                  <span className="text-muted-foreground">— none —</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">No default operator configured for {org.name}. Admins set this via Supabase or the Operators page (coming soon).</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Card className="tb-surface shadow-none">
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-serif text-4xl">{value}</div>
        {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
      </CardContent>
    </Card>
  );
}
