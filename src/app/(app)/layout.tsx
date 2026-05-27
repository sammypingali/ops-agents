import { redirect } from "next/navigation";
import { getSession, hasAnyRole } from "@/lib/auth";
import { Shell, type OrgItem } from "@/components/nav";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();

  // Admins, monitors, and ops_leads see every org. Operators and account managers
  // only see the orgs they're explicitly assigned to.
  const seesAllOrgs = hasAnyRole(session, ["admin", "monitor", "ops_lead"]);

  let orgRows: Array<{ slug: string; name: string; is_internal: boolean }> = [];
  if (seesAllOrgs) {
    const { data } = await admin
      .from("orgs")
      .select("slug, name, is_internal")
      .order("is_internal", { ascending: true })
      .order("name");
    orgRows = (data ?? []) as any;
  } else {
    const { data } = await admin
      .from("user_org_assignments")
      .select("orgs(slug, name, is_internal)")
      .eq("user_id", session.userId);
    orgRows = ((data ?? []) as any)
      .map((row: any) => row.orgs)
      .filter(Boolean)
      .sort((a: any, b: any) => Number(a.is_internal) - Number(b.is_internal) || a.name.localeCompare(b.name));
  }

  const orgs: OrgItem[] = orgRows.map((o) => ({
    slug: o.slug,
    name: o.name,
    isInternal: o.is_internal ?? false,
  }));

  return <Shell session={session} orgs={orgs}>{children}</Shell>;
}
