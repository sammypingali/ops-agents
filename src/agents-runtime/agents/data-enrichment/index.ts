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

    // 2. Enrich each lead. Contact discovery now fetches multiple pages per
    //    supplier, so we run leads in small concurrent batches (different
    //    suppliers = different hosts, so this doesn't hammer any one site) and
    //    stop starting new work past a wall-clock deadline. Anything we don't
    //    reach stays at stage=raw and gets picked up on the next run.
    let promoted = 0;
    let blocked = 0;
    let errored = 0;
    let skipped = 0;
    const blockedReasons: Record<string, number> = {};
    const startedAt = Date.now();

    type LeadRow = { id: string; supplier_id: string | null; supplier_name: string | null; material_name: string | null; payload: any };
    async function processLead(row: LeadRow): Promise<void> {
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
        return;
      }

      // Merge enrichment into payload, preserving original fields. Discovered
      // contact channels overwrite the (often empty) scout values.
      const mergedPayload = {
        ...(lead.payload ?? {}),
        enrichment: {
          website_probe: result.website_probe,
          email_check: result.email_check,
          contact: result.contact,
          tenkara_supplier: result.tenkara_supplier,
          completeness_score: result.completeness_score,
          enriched_at: new Date().toISOString(),
          enrichment_run_id: ctx.runId,
        },
        // Flatten the fields we want to query/filter on without digging into JSON.
        supplier_contact_email: result.contact.email ?? lead.payload?.supplier_contact_email ?? null,
        supplier_phone: result.contact.phone ?? result.tenkara_supplier?.poc_phone ?? lead.payload?.supplier_phone ?? null,
        contact_url: result.contact.contact_url ?? lead.payload?.contact_url ?? null,
        supplier_country: lead.payload?.supplier_country ?? result.tenkara_supplier?.country ?? null,
        completeness_score: result.completeness_score,
      };

      if (result.outreach_ready) {
        const { error: upErr } = await admin
          .from("leads_in_flight")
          .update({ stage: "enriched", payload: mergedPayload })
          .eq("id", lead.id);
        if (upErr) {
          errored++;
          await ctx.log(`Promote update failed for lead ${lead.id}: ${upErr.message}`, {
            level: "error",
            step: "promote",
            data: { lead_id: lead.id },
          });
          return;
        }
        promoted++;
        await ctx.log(
          `Promoted ${lead.supplier_name} → ${lead.material_name} (score ${result.completeness_score}, contact via ${result.contact.source ?? "none"}, ${result.contact.pages_tried}p)`,
          { step: "promote", data: { lead_id: lead.id, completeness_score: result.completeness_score, contact: result.contact } }
        );
      } else {
        const reason = result.blocked_reason ?? "unknown";
        blocked++;
        blockedReasons[reason] = (blockedReasons[reason] ?? 0) + 1;
        const { error: upErr } = await admin
          .from("leads_in_flight")
          .update({ payload: { ...mergedPayload, enrichment_blocked_reason: reason } })
          .eq("id", lead.id);
        if (upErr) {
          errored++;
          await ctx.log(`Block update failed for lead ${lead.id}: ${upErr.message}`, {
            level: "error",
            step: "block",
            data: { lead_id: lead.id },
          });
          return;
        }
        await ctx.log(`Left at raw: ${lead.supplier_name} → ${lead.material_name} (${reason}, tried ${result.contact.pages_tried}p)`, {
          step: "block",
          data: { lead_id: lead.id, reason },
        });
      }
    }

    const CONCURRENCY = 5;
    const DEADLINE_MS = 230_000; // leave headroom under the 300s function limit
    for (let i = 0; i < leads.length; i += CONCURRENCY) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        skipped = leads.length - i;
        await ctx.log(`Deadline reached — leaving ${skipped} leads at raw for the next run`, { step: "deadline" });
        break;
      }
      await Promise.all(leads.slice(i, i + CONCURRENCY).map(processLead));
    }

    ctx.setItemsProcessed(promoted + blocked);
    ctx.setStatus(errored > 0 && promoted + blocked === 0 ? "failure" : errored > 0 ? "partial" : "success");
    const reasonStr = Object.entries(blockedReasons)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    ctx.setSummary(
      `Enriched ${promoted}/${leads.length} → stage=enriched · ${blocked} left at raw${reasonStr ? ` (${reasonStr})` : ""}${skipped ? ` · ${skipped} deferred (deadline)` : ""}${errored ? ` · ${errored} errors` : ""}`
    );
  },
});
