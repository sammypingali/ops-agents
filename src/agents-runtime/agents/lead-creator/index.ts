import { registerAgent } from "../../registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryRecentMaterials, findCandidatesForMaterial, type CandidateSupplier, type MaterialRow } from "./sql";

// v1 trims (vs. full spec):
//   - existing-DB only mode. BrowserBase external discovery is gated on
//     BROWSERBASE_API_KEY; absent → we log and skip step 1b cleanly.
//   - dedup against lead_scanner_mirror over 90 days (per spec).
//   - cap 50 new leads per run.
//   - lookback window defaults to 4h but reads `last successful run` from
//     agent_runs so a missed cron doesn't drop materials.
const DEFAULT_LOOKBACK_HOURS = 4;
const RECENT_MIRROR_DAYS = 90;
const MAX_NEW_LEADS_PER_RUN = 50;

// Confidence model (deterministic, no LLM in v1):
//   quoted_same_material → 0.90 + 0.01 per extra quote (capped 0.98)
//   catalog_match        → 0.70 + 0.01 per extra catalog hit (capped 0.85)
//   quoted_similar_inci  → 0.60 + 0.01 per extra quote (capped 0.78)
//   quoted_similar_name  → 0.55 + 0.01 per extra quote (capped 0.70)
function scoreCandidate(c: CandidateSupplier): number {
  const base = {
    quoted_same_material: 0.90,
    catalog_match: 0.70,
    quoted_similar_inci: 0.60,
    quoted_similar_name: 0.55,
  }[c.signal];
  const cap = {
    quoted_same_material: 0.98,
    catalog_match: 0.85,
    quoted_similar_inci: 0.78,
    quoted_similar_name: 0.70,
  }[c.signal];
  return Math.min(cap, base + 0.01 * Math.max(0, (c.signal_count ?? 1) - 1));
}

function sourceFromSignal(signal: CandidateSupplier["signal"]): "existing_db" | "marketplace" {
  // All v1 signals come from Tenkara prod — the existing supplier graph.
  // Reserved for future: 'ai_discovery' once BrowserBase wired up.
  return signal === "catalog_match" ? "marketplace" : "existing_db";
}

registerAgent({
  slug: "agent-03-lead-creator",
  displayName: "Agent 03 - Lead Creator",
  description:
    "Cron-driven scout. For each newly-added Tenkara material, surfaces candidate suppliers from the existing supplier graph (quote history + uploaded catalogs) into leads_in_flight @ stage='raw' for human enrichment review.",
  async run(ctx) {
    const admin = createAdminClient();

    // 1. Determine lookback window: prefer last successful run; fallback to 4h.
    const { data: lastRun } = await admin
      .from("agent_runs")
      .select("run_started_at")
      .eq("agent_id", ctx.agentId)
      .eq("status", "success")
      .neq("id", ctx.runId) // ignore the current still-running row
      .order("run_started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const since = lastRun?.run_started_at
      ? new Date(lastRun.run_started_at)
      : new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 3600 * 1000);
    await ctx.log(`Pulling materials added since ${since.toISOString()}`, { step: "query" });

    // 2. Pull recent materials from Tenkara prod.
    let materials: MaterialRow[];
    try {
      materials = await queryRecentMaterials(since.toISOString());
    } catch (e: any) {
      await ctx.log(`Tenkara materials query failed: ${e.message}`, { level: "error", step: "query" });
      ctx.setStatus("failure");
      ctx.setSummary(`Failed at Tenkara materials query: ${e.message}`);
      return;
    }
    await ctx.log(`${materials.length} materials in window`, { step: "query", data: { count: materials.length } });

    if (materials.length === 0) {
      ctx.setItemsProcessed(0);
      ctx.setStatus("success");
      ctx.setSummary("No new materials in lookback window.");
      return;
    }

    // 3. Pull recent mirror entries for dedup.
    const mirrorSince = new Date(Date.now() - RECENT_MIRROR_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: mirrorRows } = await admin
      .from("lead_scanner_mirror")
      .select("supplier_name, material_name, uploaded_at")
      .gte("uploaded_at", mirrorSince);
    const mirrorPairs = new Set(
      (mirrorRows ?? []).map((r: any) =>
        `${(r.supplier_name ?? "").trim().toLowerCase()}|${(r.material_name ?? "").trim().toLowerCase()}`
      )
    );
    await ctx.log(`Loaded ${mirrorPairs.size} (supplier,material) mirror pairs for dedup`, { step: "dedup" });

    // 4. Check BrowserBase config — agent must not fail if absent.
    const browserbaseEnabled = !!process.env.BROWSERBASE_API_KEY;
    if (!browserbaseEnabled) {
      await ctx.log("BROWSERBASE_API_KEY not set — external discovery skipped (existing-DB only mode)", {
        step: "config",
        level: "info",
      });
    }

    // 5. For each material, find candidates and stage leads.
    let leadsCreated = 0;
    let materialsWithLeads = 0;
    let materialsWithoutLeads = 0;
    let skippedByMirror = 0;
    const noLeadMaterials: string[] = [];

    for (const material of materials) {
      if (leadsCreated >= MAX_NEW_LEADS_PER_RUN) {
        await ctx.log(`Hit MAX_NEW_LEADS_PER_RUN=${MAX_NEW_LEADS_PER_RUN}; stopping`, { step: "cap" });
        break;
      }

      const matLabel = material.trade_name ?? material.name ?? material.id;
      let candidates: CandidateSupplier[];
      try {
        candidates = await findCandidatesForMaterial(material);
      } catch (e: any) {
        await ctx.log(`Candidate query failed for material ${matLabel}: ${e.message}`, {
          level: "warn",
          step: "candidates",
          data: { material_id: material.id },
        });
        continue;
      }

      // Dedup candidates by supplier_id (keep best signal — order in sql.ts
      // already prefers stronger signals, so first wins).
      const seen = new Map<string, CandidateSupplier>();
      for (const c of candidates) {
        if (!seen.has(c.supplier_id)) seen.set(c.supplier_id, c);
      }
      const unique = Array.from(seen.values());

      if (unique.length === 0) {
        materialsWithoutLeads++;
        noLeadMaterials.push(matLabel);
        await ctx.log(`No candidate suppliers found for ${matLabel}`, {
          step: "candidates",
          data: { material_id: material.id, material_name: matLabel },
        });
        continue;
      }

      // Mirror-based skip (supplier_name × material_name match).
      const fresh: CandidateSupplier[] = [];
      for (const c of unique) {
        const key = `${c.supplier_name.trim().toLowerCase()}|${matLabel.trim().toLowerCase()}`;
        if (mirrorPairs.has(key)) {
          skippedByMirror++;
          continue;
        }
        fresh.push(c);
      }
      if (fresh.length === 0) {
        await ctx.log(`All ${unique.length} candidates for ${matLabel} skipped by 90d mirror dedup`, {
          step: "dedup",
          data: { material_id: material.id },
        });
        continue;
      }

      // Build insert rows.
      const budget = MAX_NEW_LEADS_PER_RUN - leadsCreated;
      const toInsert = fresh.slice(0, budget).map((c) => ({
        supplier_name: c.supplier_name,
        supplier_id: c.supplier_id,
        material_name: matLabel,
        material_id: material.id,
        stage: "raw" as const,
        status: "active" as const,
        source: sourceFromSignal(c.signal),
        payload: {
          inci_name: material.inci,
          supplier_website: c.supplier_website,
          supplier_contact_name: c.supplier_poc_name,
          supplier_contact_email: c.supplier_poc_email,
          supplier_country: c.supplier_country,
          signal: c.signal,
          signal_count: c.signal_count,
        },
        confidence_score: scoreCandidate(c),
        agent_run_id: ctx.runId,
      }));

      const { error: insErr, data: inserted } = await admin
        .from("leads_in_flight")
        .insert(toInsert)
        .select("id");
      if (insErr) {
        await ctx.log(`Insert failed for ${matLabel}: ${insErr.message}`, {
          level: "error",
          step: "insert",
          data: { material_id: material.id },
        });
        continue;
      }
      leadsCreated += inserted?.length ?? 0;
      materialsWithLeads++;
      await ctx.log(`Staged ${inserted?.length ?? 0} leads for ${matLabel}`, {
        step: "insert",
        data: {
          material_id: material.id,
          material_name: matLabel,
          lead_ids: (inserted ?? []).map((r: any) => r.id),
        },
      });
    }

    ctx.setItemsProcessed(leadsCreated);
    ctx.setStatus("success");
    ctx.setSummary(
      `Staged ${leadsCreated} raw leads across ${materialsWithLeads} material${materialsWithLeads === 1 ? "" : "s"} · ` +
        `${materialsWithoutLeads} materials had no candidates · ${skippedByMirror} candidates skipped by 90d mirror` +
        (browserbaseEnabled ? "" : " · external discovery off (no BROWSERBASE_API_KEY)") +
        (noLeadMaterials.length
          ? ` · empty: ${noLeadMaterials.slice(0, 3).join(", ")}${noLeadMaterials.length > 3 ? "…" : ""}`
          : "")
    );
  },
});
