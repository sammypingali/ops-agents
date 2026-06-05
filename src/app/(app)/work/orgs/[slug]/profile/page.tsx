import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { getSession, hasAnyRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientProfileForm, type ClientSettingsValue } from "@/components/client-profile-form";

export const dynamic = "force-dynamic";

const TYPE_VARIANT: Record<string, "success" | "secondary" | "warn" | "outline"> = {
  active: "success",
  ghost: "warn",
  skip: "secondary",
  prospect: "outline",
};

export default async function ClientProfilePage({ params }: { params: { slug: string } }) {
  const session = (await getSession())!;
  const admin = createAdminClient();
  const { data: org } = await admin.from("orgs").select("id, slug, name").eq("slug", params.slug).maybeSingle();
  if (!org) notFound();

  const [settingsRes, profileRes] = await Promise.all([
    admin
      .from("client_settings")
      .select("outreach_mode, ghost_brand, priority_tier, primary_contact_name, primary_contact_email, sourcing_notes, status, updated_at")
      .eq("org_id", org.id)
      .maybeSingle(),
    admin
      .from("client_profiles")
      .select("client_type, summary, profile, last_built_at, settings_synced_at")
      .eq("org_id", org.id)
      .maybeSingle(),
  ]);

  const settings = settingsRes.data;
  const profile = profileRes.data as any;
  const canEdit = hasAnyRole(session, ["admin", "ops_lead", "ops_operator"]);

  const initial: ClientSettingsValue | null = settings
    ? {
        outreach_mode: settings.outreach_mode,
        ghost_brand: settings.ghost_brand,
        priority_tier: settings.priority_tier,
        primary_contact_name: settings.primary_contact_name,
        primary_contact_email: settings.primary_contact_email,
        sourcing_notes: settings.sourcing_notes,
        status: settings.status,
      }
    : null;

  const stale = !!(settings && profile && profile.settings_synced_at !== settings.updated_at);

  return (
    <div className="space-y-6">
      {/* Agent-maintained rendition */}
      <Card className="tb-surface shadow-none">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-medium">Client profile</CardTitle>
            {profile && <Badge variant={TYPE_VARIANT[profile.client_type] ?? "secondary"}>{profile.client_type}</Badge>}
          </div>
          <CardDescription>
            Maintained by Agent 12 — rebuilds whenever the client settings change.
            {profile?.last_built_at && ` Last built ${new Date(profile.last_built_at).toLocaleString()}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!profile ? (
            <p className="text-muted-foreground">No profile yet. Save the client settings below to generate one.</p>
          ) : (
            <>
              {profile.summary && <p className="font-medium">{profile.summary}</p>}
              {stale && (
                <p className="text-xs text-amber-700">Settings changed since the last build — Agent 12 will re-sync this shortly.</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">
                <Stat label="Leads" value={profile.profile?.activity?.leads ?? 0} />
                <Stat label="Drafts" value={profile.profile?.activity?.drafts ?? 0} />
                <Stat label="Tier" value={profile.profile?.priority_tier ?? "—"} />
                <Stat label="Contact" value={profile.profile?.primary_contact_name ?? "—"} />
                <Stat label="Email" value={profile.profile?.primary_contact_email ?? "—"} />
                {profile.profile?.ghost_brand && <Stat label="Ghost brand" value={profile.profile.ghost_brand} />}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Ops-editable settings */}
      <Card className="tb-surface shadow-none">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-medium">Client settings</CardTitle>
            {settings && (
              <Badge variant={settings.status === "finalized" ? "success" : "secondary"}>{settings.status}</Badge>
            )}
          </div>
          <CardDescription>Ops-curated inputs. Finalizing copies these into the profile above.</CardDescription>
        </CardHeader>
        <CardContent>
          <ClientProfileForm orgId={org.id} initial={initial} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5 break-words">{value}</div>
    </div>
  );
}
