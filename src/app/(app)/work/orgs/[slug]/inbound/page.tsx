import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Reply drafts Agent 08 composed for inbound supplier emails — the operator
// reviews and sends each in Missive.
export default async function OrgInboundPage({ params }: { params: { slug: string } }) {
  const admin = createAdminClient();
  const { data: org } = await admin.from("orgs").select("id, slug, name").eq("slug", params.slug).maybeSingle();
  if (!org) notFound();

  const { data: rows } = await admin
    .from("draft_references")
    .select("id, subject, status, metadata, created_at")
    .eq("org_id", org.id)
    .eq("metadata->>draft_kind", "inbound_reply")
    .order("created_at", { ascending: false })
    .limit(100);
  const drafts = rows ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Supplier replies for {org.name} — Agent 08 drafted a response for each. Review and send in Missive; nothing goes out automatically.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reply draft</TableHead>
            <TableHead>QA</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Drafted</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drafts.map((d: any) => {
            const findings = (d.metadata?.qa_findings ?? []) as any[];
            const errs = findings.filter((f) => f.severity === "error").length;
            const link = d.metadata?.missive_draft_link as string | undefined;
            return (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.subject ?? "(no subject)"}</TableCell>
                <TableCell>
                  {errs > 0 ? <Badge variant="danger">{errs} to fix</Badge> : findings.length > 0 ? <Badge variant="warn">{findings.length}</Badge> : <span className="text-xs text-muted-foreground">clean</span>}
                </TableCell>
                <TableCell><Badge variant="secondary">{d.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{relativeTime(d.created_at)}</TableCell>
                <TableCell>
                  {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm">Open in Missive ↗</a> : "—"}
                </TableCell>
              </TableRow>
            );
          })}
          {drafts.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No inbound reply drafts.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
