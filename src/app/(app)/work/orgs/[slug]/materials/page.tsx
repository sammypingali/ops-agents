import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession, hasAnyRole } from "@/lib/auth";
import { getMaterialProfile } from "@/lib/material-profile";
import { getMaterialSourcingStatus } from "@/lib/material-sourcing-status";
import { MaterialsPanel } from "@/components/materials-panel";

export const dynamic = "force-dynamic";

export default async function OrgMaterialsPage({ params }: { params: { slug: string } }) {
  const session = await getSession();
  const admin = createAdminClient();
  const { data: org } = await admin.from("orgs").select("id, slug, tenkara_org_id").eq("slug", params.slug).maybeSingle();
  if (!org) notFound();

  const profile = await getMaterialProfile(org.id);
  const statuses = await getMaterialSourcingStatus(admin, org.id, org.tenkara_org_id ?? null, profile);
  const canEdit = hasAnyRole(session, ["admin", "ops_lead", "ops_operator"]);

  return <MaterialsPanel orgId={org.id} slug={org.slug} profile={profile} canEdit={canEdit} statuses={statuses} />;
}
