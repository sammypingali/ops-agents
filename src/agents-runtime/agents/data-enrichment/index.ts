import { registerAgent } from "../../registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichLead, type RawLead, type EnrichmentResult } from "./enrich";

// v1 trim (vs. full spec):
//   - pre-outreach only. Reply-driven enrichment lands when Agent 08
//     (Email Scanner) ships.
//   - cron-style sweep of stage='raw' & status='active' leads, ordered by
//     confidence_score DESC so the most promising candidates get enriched first.
//   - cap 25 leads/run. The probe step is network-bound (HEAD requests with
//     8s timeout each), so 25 keeps us comfortably under the 300s Vercel
//     Hobby maxDuration even in worst-case all-timeout scenarios.
const MAX_LEADS_PER_RUN = 25;

registerAgent({
  slug: "agent-06-enrichment",
  displayName: "Agent 06 - Data Enrichment",
  description:
    "Pre-outreach enrichment. Sweeps stage=raw leads, probes supplier website + contact email, merges Tenkara supplier metadata, then promotes to stage=enriched for human review.",
  async run(ctx) {
    const admin = createAdminClient();

    // 1. Pull a batch of raw leads, best confidence first.
    const { data: leads, error: pullErr } = await admin
      .from("leads_in_flight")
      .select("id, supplier_id, supplier_name, material_name, payload")
      .eq("stage", "raw")
      .eq("status", "active")
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .limit(MAX_LEADS_PER_RUN);

    if (pullErr) {
      await ctx.log(`Failed to pull raw leads: ${pullErr.message}`, { level: "error", step: "pull" });
      ctx.setStatus("failure");
      ctx.setSummary(`Pull failed: ${pullErr.message}`);
      return;
    }

    if (!leads || leads.length === 0) {
      ctx.setItemsProcessed(0);
      ctx.setStatus("success");
      ctx.setSummary("No raw leads to enrich.");
      return;
    }

    await ctx.log(`Enriching ${leads.length} raw leads`, { step: "pull", data: { count: leads.length } });

    // 2. Enrich each lead. We process serially — each lead has its own network
    //    work (HEAD probe + Tenkara query), and bursting parallel probes can
    //    trip rate limits on supplier sites that don't expect bot traffic.
    let promoted = 0;
    let blocked = 0;
    let errored = 0;
    const blockedReasons: Record<string, number> = {};

    for (const row of leads) {
      const lead: RawLead = {
        id: row.id,
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        material_name: row.material_name,
        payload: row.payload ?? {},
      };

      let result: EnrichmentResult;
      try {
        result = await enrichLead(lead);
      } catch (e: any) {
        errored++;
        await ctx.log(`Enrichment threw for lead ${lead.id}: ${e.message}`, {
          level: "warn",
          step: "enrich",
          data: { lead_id: lead.id },
        });
        continue;
      }

      // Merge enrichment into payload, preserving original fields.
      const mergedPayload = {
        ...(lead.payload ?? {}),
        enrichment: {
          website_probe: result.website_probe,
          email_check: result.email_check,
          tenkara_supplier: result.tenkara_supplier,
          completeness_score: result.completeness_score,
          enriched_at: new Date().toISOString(),
          enrichment_run_id: ctx.runId,
        },
        // Flatten a few fields we want to query/filter on without digging into JSON.
        supplier_phone: result.tenkara_supplier?.poc_phone ?? lead.payload?.supplier_phone ?? null,
        supplier_country: lead.payload?.supplier_country ?? result.tenkara_supplier?.country ?? null,
        completeness_score: result.completeness_score,
      };

      if (result.outreach_ready) {
        const { error: upErr } = await admin
          .from("leads_in_flight")
          .update({
            stage: "enriched",
            payload: mergedPayload,
          })
          .eq("id", lead.id);
        if (upErr) {
          errored++;
          await ctx.log(`Promote update failed for lead ${lead.id}: ${upErr.message}`, {
            level: "error",
            step: "promote",
            data: { lead_id: lead.id },
          });
          continue;
        }
        promoted++;
        await ctx.log(`Promoted lead ${lead.supplier_name} → ${lead.material_name} (score ${result.completeness_score})`, {
          step: "promote",
          data: { lead_id: lead.id, completeness_score: result.completeness_score },
        });
      } else {
        const reason = result.blocked_reason ?? "unknown";
        blocked++;
        blockedReasons[reason] = (blockedReasons[reason] ?? 0) + 1;
        const { error: upErr } = await admin
          .from("leads_in_flight")
          .update({
            payload: { ...mergedPayload, enrichment_blocked_reason: reason },
          })
          .eq("id", lead.id);
        if (upErr) {
          errored++;
          await ctx.log(`Block update failed for lead ${lead.id}: ${upErr.message}`, {
            level: "error",
            step: "block",
            data: { lead_id: lead.id },
          });
          continue;
        }
        await ctx.log(`Left at raw: ${lead.supplier_name} → ${lead.material_name} (${reason})`, {
          step: "block",
          data: { lead_id: lead.id, reason },
        });
      }
    }

    ctx.setItemsProcessed(promoted + blocked);
    ctx.setStatus(errored > 0 && promoted + blocked === 0 ? "failure" : errored > 0 ? "partial" : "success");
    const reasonStr = Object.entries(blockedReasons)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    ctx.setSummary(
      `Enriched ${promoted}/${leads.length} → stage=enriched · ${blocked} left at raw${reasonStr ? ` (${reasonStr})` : ""}${errored ? ` · ${errored} errors` : ""}`
    );
  },
});
