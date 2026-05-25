import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Shell, type OrgItem } from "@/components/nav";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: orgRows } = await admin
    .from("orgs")
    .select("slug, name, is_internal")
    .order("is_internal", { ascending: true })  // client orgs first, internal/testing last
    .order("name");

  const orgs: OrgItem[] = (orgRows ?? []).map((o: any) => ({
    slug: o.slug,
    name: o.name,
    isInternal: o.is_internal ?? false,
  }));

  return <Shell session={session} orgs={orgs}>{children}</Shell>;
}
