import { registerAgent } from "../../registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { rebuildStaleClientProfiles } from "@/lib/client-profile";

// Agent 12 - Client Profile.
//
// Profiles are primarily rebuilt INLINE when ops change a client's settings
// (see src/app/actions/client-settings.ts), so the org's Client Profile tab
// updates immediately. This scheduled run is the backstop: it re-syncs any org
// whose profile drifted out of sync with its settings.updated_at (e.g. an
// inline build failed, or settings predate the agent).
//
// OA-only: reads client_settings + OA activity counts, writes client_profiles.
// Never reads Tenkara or stages drafts.

registerAgent({
  slug: "agent-12-client-profile",
  displayName: "Agent 12 - Client Profile",
  description:
    "Backstop sweep for client profiles. Re-syncs any org whose client_profiles row drifted out of sync with its client_settings. Profiles normally rebuild inline when ops edit settings. OA-only.",
  async run(ctx) {
    const admin = createAdminClient();
    let res;
    try {
      res = await rebuildStaleClientProfiles(admin, { runId: ctx.runId });
    } catch (e: any) {
      await ctx.log(`Sweep failed: ${e.message}`, { level: "error", step: "sweep" });
      ctx.setStatus("failure");
      ctx.setSummary(`Sweep failed: ${e.message}`);
      return;
    }

    ctx.setItemsProcessed(res.built);
    ctx.setStatus(res.errored > 0 && res.built === 0 ? "failure" : res.errored > 0 ? "partial" : "success");
    ctx.setSummary(
      res.checked === 0
        ? "No client settings to profile."
        : `Re-synced ${res.built} profile(s) of ${res.checked} client(s)${res.errored ? ` · ${res.errored} errors` : ""}.`
    );
  },
});
