# Session 05 — Schema reconciliation + Agent 03 Lead Creator

## Agents built this session
- **Agent 03 - Lead Creator** — **E2E verified in production**.
  - Run `c9c6665b-34de-4b84-b847-32ec967cbe9e` (manual, 720h backfill, 16s) — `success` with `items_processed=50`.
  - Summary: *Staged 50 raw leads across 29 materials · 23 materials had no candidates · 0 candidates skipped by 90d mirror · external discovery off (no BROWSERBASE_API_KEY)*.
  - Real Tenkara supplier signal — top hits scored 0.94-0.98 (`quoted_same_material`, signal counts 5-9): BulkSupplements.com, NutriVita Shop, Ingredients Online, Cascade Botanicals, Harbor Labs, PureBulk, Chem-Impex.
  - `MAX_NEW_LEADS_PER_RUN=50` cap fired correctly mid-list.
  - Code: [`src/agents-runtime/agents/lead-creator/index.ts`](../src/agents-runtime/agents/lead-creator/index.ts), [`sql.ts`](../src/agents-runtime/agents/lead-creator/sql.ts)

### v1 trims (agreed up-front)
- **Existing-DB only mode** — BrowserBase external discovery gated on `BROWSERBASE_API_KEY`. Absent → log + skip cleanly.
- Dedup against `lead_scanner_mirror` over 90 days (supplier × material name pair).
- Cap `MAX_NEW_LEADS_PER_RUN = 50`.
- No `schedule_cron` yet — manual-only first (same pattern as Agent 11).
- Lookback window: prefers "since last successful run"; falls back to 4h. `LEAD_CREATOR_LOOKBACK_HOURS` env var available for ops backfills.

### Candidate-finding signals (Tenkara prod, mcp_readonly)
| Signal                  | Source table                       | Confidence base | Cap   |
|-------------------------|------------------------------------|-----------------|-------|
| `quoted_same_material`  | `material_quotes` (exact match)    | 0.90            | 0.98  |
| `catalog_match`         | `supplier_catalog_materials`       | 0.70            | 0.85  |
| `quoted_similar_inci`   | `material_quotes` join `materials` | 0.60            | 0.78  |
| `quoted_similar_name`   | `material_quotes` join `materials` | 0.55            | 0.70  |

`+0.01` per extra signal count, capped per row.

## Infra / platform changes
- **Migration 0010 — stage vocab reconciliation.** `leads_in_flight.stage` check constraint now matches the spec: `('raw'|'enriched'|'ready_for_outreach'|'ready_for_approval'|'terminal')`. Existing rows remapped (`raw_discovery`→`raw`, `gap_analysis`→`enriched`, `approval`→`ready_for_approval`, `exported`→`terminal`).
- **Migration 0011 — register Agent 03.** Embedded runtime, no schedule yet.
- **Migration 0006 fix — idempotent ping seed.** Was inserting a legacy `ping` row that 0008 would then try to rename into a duplicate-key conflict whenever `npm run db:push` ran a second time. Now seeds the final `agent-01-ping` slug directly; 0008's UPDATE becomes a clean no-op on re-runs.
- **Cleaned up orphan `ping` row in OA prod** that 0006's pre-fix version had recreated this session.
- **`LEAD_CREATOR_LOOKBACK_HOURS` env override.** Set briefly to `720` for the E2E test, then removed from both Vercel projects (would otherwise short-circuit the "since last successful run" logic in production).

## Schema items deferred (not blocking the next agents)
- `lead_id uuid` column on `lead_scanner_exports` — would let Agent 11 dedup at lead level instead of supplier level. Defer until we have a reason to swap.
- `agent_state` table — wait until Agent 08 (Email Scanner) actually needs durable inbox state.
- `agent_rules` seed rows for Agent 03 (`browserbase_enabled` per-org). Skipped because v1 reads from env var; revisit when we wire per-org switching.

## Verification
- Migration sequence applied cleanly via `npm run db:push` (10 → 11).
- Live trigger: `GET /api/cron?slug=agent-03-lead-creator` with `Authorization: Bearer $CRON_SECRET`.
- Confirmed in DB: 50 `leads_in_flight` rows with `stage='raw'`, real `supplier_name`/`material_name`/`confidence_score`/`payload`, and `agent_run_id` populated.
- Confirmed all hard constraints: no emails, no Tenkara prod writes, OA writes only, mcp_readonly verified at pool init.

## v1.1 follow-ups (parked)
- **BrowserBase external discovery (step 1b).** When `<3` existing candidates AND key configured, search for 5-10 new supplier candidates matching the material spec. Requires an additional `agent_rules` row for per-org quota gating.
- **`source='ai_discovery'`** label once external discovery ships.
- **`source='marketplace'`** is currently used as a proxy for catalog matches — re-check the source vocabulary spec once marketplace sourcing is real.
- **Daily/4h cron.** Add `schedule_cron='0 */4 * * *'` once we're off Vercel Hobby (currently capped at daily).
- **Per-org `browserbase_enabled` flag** in `agent_rules`. Today the flag is global via env var.
- **Cap by material count, not lead count.** 50/run can fully process one big material with many candidates; we may want a smaller per-material cap so leads aren't lopsided.

## Agents pending
| # | Agent | Status | Next action |
|---|-------|--------|-------------|
| 04 | Outreach | spec received | Sequence per spec doc |
| 05 | Marketplace Validation | spec received | Sequence per spec doc |
| 06 | Data Enrichment | spec received | Sequence per spec doc |
| 07 | Escalation | spec received | Sequence per spec doc |
| 08 | Email Scanner | spec received | Confirm Missive PAT has `conversations:list` + `conversations:read` scopes first; needs `agent_state` table |
| 09 | Doc Refresh | spec received | Sequence per spec doc |
| 10 | QA Outreach | spec received | Sequence per spec doc |

## Blockers carried into next session
- None. 4 / 11 agents shipped.

## Suggested next session
- Pick the next agent. Agent 09 (Doc Refresh) is the cleanest next — single Missive draft per supplier, no new infra needed beyond what Agent 02 already uses. Agent 08 (Email Scanner) needs Missive scope review + `agent_state` first.
