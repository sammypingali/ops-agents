import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { getSession, hasAnyRole } from "@/lib/auth";
import { ClientProfilePanel, type ProfileValue, type SettingsValue, type UploadItem } from "@/components/client-profile-form";
import { MaterialsPanel } from "@/components/materials-panel";
import { PricingPipelineTable } from "@/components/pricing-pipeline-table";
import { getMaterialProfile } from "@/lib/material-profile";
import { loadPricingThreads } from "@/lib/pricing-pipeline";

export const dynamic = "force-dynamic";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-serif text-2xl tracking-tight">{children}</h2>;
}

export default async function ClientProfilePage({ params }: { params: { slug: string } }) {
  const session = (await getSession())!;
  const admin = createAdminClient();
  const { data: org } = await admin.from("orgs").select("id, slug, name").eq("slug", params.slug).maybeSingle();
  if (!org) notFound();

  const [profileRes, settingsRes, uploadsRes] = await Promise.all([
    admin
      .from("client_profiles")
      .select("client_type, summary, highlights, sources, rep_sheet, last_generated_at, manual_override")
      .eq("org_id", org.id)
      .maybeSingle(),
    admin
      .from("client_settings")
      .select("outreach_mode, ghost_brand, priority_tier, primary_contact_name, primary_contact_email, sourcing_notes")
      .eq("org_id", org.id)
      .maybeSingle(),
    admin
      .from("client_uploads")
      .select("id, kind, file_name, content_text, created_at")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const p = profileRes.data as any;
  const profile: ProfileValue | null = p
    ? {
        client_type: p.client_type ?? null,
        summary: p.summary ?? null,
        highlights: Array.isArray(p.highlights) ? p.highlights : [],
        sources: Array.isArray(p.sources) ? p.sources : [],
        rep_sheet: p.rep_sheet && typeof p.rep_sheet === "object" ? p.rep_sheet : {},
        last_generated_at: p.last_generated_at ?? null,
        manual_override: !!p.manual_override,
      }
    : null;

  const settings: SettingsValue | null = settingsRes.data
    ? {
        outreach_mode: settingsRes.data.outreach_mode,
        ghost_brand: settingsRes.data.ghost_brand,
        priority_tier: settingsRes.data.priority_tier,
        primary_contact_name: settingsRes.data.primary_contact_name,
        primary_contact_email: settingsRes.data.primary_contact_email,
        sourcing_notes: settingsRes.data.sourcing_notes,
      }
    : null;

  const uploads = (uploadsRes.data ?? []) as UploadItem[];
  const canEdit = hasAnyRole(session, ["admin", "ops_lead", "ops_operator"]);

  // Comprehensive client tracker: profile, then this client's materials, then
  // the live sourcing pipeline — one place to see who the client is, what they
  // buy, and where each thread stands.
  const [materialProfile, pipeline] = await Promise.all([
    getMaterialProfile(org.id),
    loadPricingThreads(admin, [org.id]),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Who this client is — researched from the web plus their Tenkara data, your settings, and uploads, and summarized
          here for you to edit.
        </p>
        <ClientProfilePanel orgId={org.id} profile={profile} settings={settings} uploads={uploads} canEdit={canEdit} />
      </section>

      <section className="space-y-4">
        <div>
          <SectionTitle>Materials</SectionTitle>
          <p className="text-sm text-muted-foreground mt-1">
            What this client buys — order frequency, shelf-life, and quote expiry, with PO history.
          </p>
        </div>
        <MaterialsPanel orgId={org.id} profile={materialProfile} canEdit={canEdit} />
      </section>

      <section className="space-y-4">
        <div>
          <SectionTitle>Sourcing pipeline</SectionTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Every supplier thread for this client, from outreach to a finalized price.
          </p>
        </div>
        <PricingPipelineTable
          data={pipeline}
          emptyReason="No tracked threads yet. They appear here once outreach is staged for this client."
          slug={org.slug}
        />
      </section>
    </div>
  );
}
