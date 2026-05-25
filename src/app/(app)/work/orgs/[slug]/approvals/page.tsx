import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { ApprovalsTable } from "@/components/approvals-table";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ params }: { params: { slug: string } }) {
  const admin = createAdminClient();
  const { data: org } = await admin.from("orgs").select("id, slug, name").eq("slug", params.slug).maybeSingle();
  if (!org) notFound();

  const { data: rows } = await admin
    .from("pending_approvals")
    .select("id, type, status, requested_at, decided_at, notes, payload, agents(name, slug)")
    .eq("org_id", org.id)
    .order("requested_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-2xl">Approvals</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Agent outputs awaiting human sign-off. After approving, download the CSV and upload it to Tenkara&apos;s bulk-upload UI, then mark it as uploaded so the loop closes.
        </p>
      </div>
      <ApprovalsTable orgSlug={org.slug} rows={(rows ?? []) as any} />
    </div>
  );
}
