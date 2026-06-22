import type { createAdminClient } from "@/lib/supabase/admin";
import { buildSourcingScorecard, type SourcingScorecardLine } from "@/lib/sourcing-scorecard";
import type { MaterialProfile, MaterialProfileRow } from "@/lib/material-profile";

type Admin = ReturnType<typeof createAdminClient>;

export type SourcingStatusKey =
  | "sourced"
  | "above"
  | "quotes"
  | "outreach"
  | "sourcing"
  | "expiring"
  | "current"
  | "not_started";

export interface MaterialSourcingStatus {
  key: SourcingStatusKey;
  label: string;
  reason: string;
  // Tailwind classes for the chip.
  cls: string;
  // Tab suffix to deep-link into (null = no link).
  tab: string | null;
}

function expiryInfo(iso: string | null): { days: number | null; label: string } {
  if (!iso) return { days: null, label: "" };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { days: null, label: "" };
  const days = Math.round((t - Date.now()) / (24 * 3600 * 1000));
  if (days < 0) return { days, label: "expired" };
  return { days, label: `expires in ${days}d` };
}

// Rank scorecard lines so a material with several units resolves to its most
// favorable sourcing signal (beating > has-quotes > above > none).
function rankLine(l: SourcingScorecardLine): number {
  if (l.status === "beating") return 0;
  if (l.n_sourced > 0) return 1;
  if (l.status === "above") return 2;
  return 3;
}

function compute(m: MaterialProfileRow, score: SourcingScorecardLine | undefined, leads: number, drafts: number): MaterialSourcingStatus {
  const pct = score?.beats_client_pct != null ? Math.abs(score.beats_client_pct).toFixed(0) : null;
  if (score?.status === "beating") {
    return { key: "sourced", label: "Sourced", reason: pct ? `beats by ${pct}%` : "below current", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", tab: "/savings" };
  }
  if (score && score.n_sourced > 0 && score.status !== "above") {
    return { key: "quotes", label: "Quotes in", reason: `${score.n_sourced} quote${score.n_sourced === 1 ? "" : "s"}`, cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", tab: "/quotes" };
  }
  if (score?.status === "above") {
    return { key: "above", label: "Above client", reason: pct ? `+${pct}%` : "above current", cls: "bg-red-500/15 text-red-700 dark:text-red-400", tab: "/savings" };
  }
  if (drafts > 0) {
    return { key: "outreach", label: "Outreach sent", reason: "awaiting replies", cls: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", tab: "/threads" };
  }
  if (leads > 0) {
    return { key: "sourcing", label: "Sourcing", reason: `${leads} lead${leads === 1 ? "" : "s"}`, cls: "bg-teal-500/15 text-teal-700 dark:text-teal-300", tab: "/leads" };
  }
  const exp = expiryInfo(m.currentQuoteExpiry);
  if (exp.days != null && exp.days <= 30) {
    return { key: "expiring", label: "Expiring", reason: exp.label, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", tab: "/price-index" };
  }
  if (m.currentQuoteExpiry) {
    return { key: "current", label: "Current", reason: "quote valid", cls: "bg-secondary text-secondary-foreground", tab: null };
  }
  return { key: "not_started", label: "Not started", reason: "no sourcing yet", cls: "border border-border text-muted-foreground", tab: "/leads" };
}

// Per-material sourcing status, keyed by Tenkara material_id. Combines the
// sourcing scorecard (collected quotes / beats-client), in-flight leads &
// outreach drafts, and current-quote expiry into one chip per material.
export async function getMaterialSourcingStatus(
  admin: Admin,
  orgId: string,
  tenkaraOrgId: string | null,
  profile: MaterialProfile
): Promise<Record<string, MaterialSourcingStatus>> {
  const [leadsRes, draftsRes] = await Promise.all([
    admin.from("leads_in_flight").select("material_id").eq("org_id", orgId).eq("status", "active"),
    admin.from("draft_references").select("material_id").eq("org_id", orgId).eq("status", "staged"),
  ]);
  const leadCount = new Map<string, number>();
  for (const r of leadsRes.data ?? []) if (r.material_id) leadCount.set(r.material_id, (leadCount.get(r.material_id) ?? 0) + 1);
  const draftCount = new Map<string, number>();
  for (const r of draftsRes.data ?? []) if (r.material_id) draftCount.set(r.material_id, (draftCount.get(r.material_id) ?? 0) + 1);

  const scoreByMat = new Map<string, SourcingScorecardLine>();
  if (tenkaraOrgId) {
    const sc = await buildSourcingScorecard(admin, orgId, tenkaraOrgId).catch(() => null);
    for (const l of sc?.lines ?? []) {
      const prev = scoreByMat.get(l.material_id);
      if (!prev || rankLine(l) < rankLine(prev)) scoreByMat.set(l.material_id, l);
    }
  }

  const out: Record<string, MaterialSourcingStatus> = {};
  for (const m of profile.materials) {
    if (!m.tenkaraMaterialId) continue;
    out[m.tenkaraMaterialId] = compute(m, scoreByMat.get(m.tenkaraMaterialId), leadCount.get(m.tenkaraMaterialId) ?? 0, draftCount.get(m.tenkaraMaterialId) ?? 0);
  }
  return out;
}
