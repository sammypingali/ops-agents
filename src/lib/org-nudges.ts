import type { createAdminClient } from "@/lib/supabase/admin";

// Per-org "what's waiting on a human" counts. Used by the org overview cards and
// the top-level nudge dashboard so both read the same numbers.

type Admin = ReturnType<typeof createAdminClient>;

export interface OrgNudgeCounts {
  newLeads: number;     // leads_in_flight stage=raw (fresh discoveries)
  draftsToSend: number; // staged drafts awaiting a human Send
  priceChanges: number; // marketplace findings pending review
  openCases: number;    // escalation cases to own
}

export async function getOrgNudgeCounts(admin: Admin, orgId: string): Promise<OrgNudgeCounts> {
  const head = { count: "exact" as const, head: true };
  const [leadsR, draftsR, priceR, casesR] = await Promise.all([
    admin.from("leads_in_flight").select("id", head).eq("org_id", orgId).eq("status", "active").eq("stage", "raw"),
    admin.from("draft_references").select("id", head).eq("org_id", orgId).eq("status", "staged"),
    admin.from("marketplace_check_findings").select("id", head).eq("org_id", orgId).eq("status", "pending_review"),
    admin.from("cases").select("id", head).eq("org_id", orgId).eq("status", "open"),
  ]);
  return {
    newLeads: leadsR.count ?? 0,
    draftsToSend: draftsR.count ?? 0,
    priceChanges: priceR.count ?? 0,
    openCases: casesR.count ?? 0,
  };
}

export function totalNudges(c: OrgNudgeCounts): number {
  return c.newLeads + c.draftsToSend + c.priceChanges + c.openCases;
}
