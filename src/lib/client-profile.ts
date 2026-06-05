import type { SupabaseClient } from "@supabase/supabase-js";

// Shared client-profile builder. Called two ways:
//   - inline from the client-settings server actions, so the profile updates
//     the moment ops change a client's settings (event-driven);
//   - from Agent 12's cron sweep, as a backstop that catches any org whose
//     profile drifted out of sync with its settings (e.g. an inline build
//     failed, or settings predate the agent).
//
// OA-only: reads client_settings + OA activity counts, writes client_profiles.
// Never reads Tenkara or stages drafts.

export type OutreachMode = "active" | "ghost" | "skip";
export type ClientType = "active" | "ghost" | "skip" | "prospect";

export interface SettingsRow {
  org_id: string;
  outreach_mode: OutreachMode;
  ghost_brand: string | null;
  priority_tier: "standard" | "priority" | "vip";
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  sourcing_notes: string | null;
  status: "draft" | "finalized";
  updated_at: string;
}

const SETTINGS_COLS =
  "org_id, outreach_mode, ghost_brand, priority_tier, primary_contact_name, primary_contact_email, sourcing_notes, status, updated_at";

// active outreach with no work yet reads as a prospect, not a live account.
function deriveClientType(mode: OutreachMode, activity: { leads: number; drafts: number }): ClientType {
  if (mode === "ghost") return "ghost";
  if (mode === "skip") return "skip";
  if (activity.leads === 0 && activity.drafts === 0) return "prospect";
  return "active";
}

function buildSummary(clientType: ClientType, tier: SettingsRow["priority_tier"], activity: { leads: number; drafts: number }): string {
  const tierLabel = tier === "standard" ? "" : `${tier} · `;
  return `${tierLabel}${clientType} · ${activity.leads} leads, ${activity.drafts} drafts`;
}

export interface BuildResult {
  status: "built" | "skipped" | "no_settings" | "error";
  clientType?: ClientType;
  error?: string;
}

// Build (or rebuild) the profile for one org from its current settings.
export async function rebuildClientProfile(
  admin: SupabaseClient,
  orgId: string,
  opts: { runId?: string | null } = {}
): Promise<BuildResult> {
  const { data: settings, error: settingsErr } = await admin
    .from("client_settings")
    .select(SETTINGS_COLS)
    .eq("org_id", orgId)
    .maybeSingle();
  if (settingsErr) return { status: "error", error: settingsErr.message };
  if (!settings) return { status: "no_settings" };

  return writeProfile(admin, settings as SettingsRow, opts.runId ?? null);
}

// Sweep backstop: rebuild every org whose profile is missing or out of sync
// with its settings.updated_at. Returns counts for the run summary.
export async function rebuildStaleClientProfiles(
  admin: SupabaseClient,
  opts: { runId?: string | null; limit?: number } = {}
): Promise<{ built: number; errored: number; checked: number }> {
  const limit = opts.limit ?? 200;
  const { data: settings, error } = await admin.from("client_settings").select(SETTINGS_COLS).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (settings ?? []) as SettingsRow[];
  if (rows.length === 0) return { built: 0, errored: 0, checked: 0 };

  const { data: profiles } = await admin
    .from("client_profiles")
    .select("org_id, settings_synced_at")
    .in(
      "org_id",
      rows.map((r) => r.org_id)
    );
  const syncedAt = new Map<string, string | null>((profiles ?? []).map((p: any) => [p.org_id, p.settings_synced_at]));

  let built = 0;
  let errored = 0;
  for (const s of rows) {
    if (syncedAt.get(s.org_id) === s.updated_at) continue; // already in sync
    const res = await writeProfile(admin, s, opts.runId ?? null);
    if (res.status === "built") built++;
    else if (res.status === "error") errored++;
  }
  return { built, errored, checked: rows.length };
}

async function writeProfile(admin: SupabaseClient, s: SettingsRow, runId: string | null): Promise<BuildResult> {
  const [leadsRes, draftsRes] = await Promise.all([
    admin.from("leads_in_flight").select("id", { count: "exact", head: true }).eq("org_id", s.org_id),
    admin.from("draft_references").select("id", { count: "exact", head: true }).eq("org_id", s.org_id),
  ]);
  const activity = { leads: leadsRes.count ?? 0, drafts: draftsRes.count ?? 0 };

  const clientType = deriveClientType(s.outreach_mode, activity);
  const now = new Date().toISOString();

  const { error } = await admin.from("client_profiles").upsert(
    {
      org_id: s.org_id,
      client_type: clientType,
      summary: buildSummary(clientType, s.priority_tier, activity),
      profile: {
        outreach_mode: s.outreach_mode,
        ghost_brand: s.ghost_brand,
        priority_tier: s.priority_tier,
        primary_contact_name: s.primary_contact_name,
        primary_contact_email: s.primary_contact_email,
        sourcing_notes: s.sourcing_notes,
        settings_status: s.status,
        activity,
      },
      settings_synced_at: s.updated_at,
      last_built_at: now,
      last_run_id: runId,
      updated_at: now,
    },
    { onConflict: "org_id" }
  );
  if (error) return { status: "error", error: error.message };
  return { status: "built", clientType };
}
