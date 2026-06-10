import { registerAgent } from "../../registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshStaleClientProfiles } from "@/lib/client-profile";

// Agent 12 - Client Profile.
//
// Profiles are generated on demand (the "Generate / Refresh" button on each
// org's Client Profile tab) and whenever ops upload info. This scheduled run
// is a LIGHT backstop: it re-researches a few stale or missing profiles per
// run (web_search is costly, so it's capped). It respects ops edits
// (manual_override) — only an explicit regen overrides those.
//
// OA writes only; Tenkara is read-only and best-effort.

registerAgent({
  slug: "agent-12-client-profile",
  displayName: "Agent 12 - Client Profile",
  description:
    "Researches and maintains client profiles. Backstop sweep: re-researches a few stale/missing profiles per run (web_search + Tenkara + settings + uploads, summarized). On-demand generation drives the rest. OA-only.",
  async run(ctx) {
    const admin = createAdminClient();
    let res;
    try {
      res = await refreshStaleClientProfiles(admin, { runId: ctx.runId, limit: 3 });
    } catch (e: any) {
      await ctx.log(`Refresh failed: ${e.message}`, { level: "error", step: "refresh" });
      ctx.setStatus("failure");
      ctx.setSummary(`Refresh failed: ${e.message}`);
      return;
    }

    ctx.setItemsProcessed(res.generated);
    ctx.setStatus(res.errored > 0 && res.generated === 0 ? "failure" : res.errored > 0 ? "partial" : "success");
    ctx.setSummary(
      res.considered === 0
        ? "No clients to profile yet."
        : `Researched ${res.generated} stale profile(s)${res.skipped ? ` · ${res.skipped} skipped (edited)` : ""}${res.errored ? ` · ${res.errored} errors` : ""} of ${res.considered} clients.`
    );
  },
});
