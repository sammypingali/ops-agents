# Tackle Box — Agents Overview

Reference doc for building a test plan. Lists every agent in the fleet (shipped + deferred), what it does, what it reads, what it writes, its safety constraints, and the failure modes to exercise.

Source of truth for descriptions: `public.agents` table in the OA Supabase project (`aiyzpjnvenfmurhyamge`), pulled on 2026-05-27.

---

## Shared stack (applies to all agents)

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.15 (App Router), TypeScript |
| Runtime | Vercel (Hobby plan, 300s function maxDuration, daily-cron cap) |
| Agent runtime | Embedded — each agent registers itself via `registerAgent({ slug, displayName, description, run(ctx) })` and is dispatched by `runClaimed()` in `src/agents-runtime/runtime.ts` |
| OA database | Supabase project `aiyzpjnvenfmurhyamge` — full read/write via `createAdminClient()` from `@/lib/supabase/admin`. Tables: `agents`, `agent_runs`, `agent_run_events`, `agent_state`, `leads_in_flight`, `draft_references`, `cases`, `org_default_operators`, `lead_scanner_exports`, `audit_log` |
| Tenkara prod | Supabase project `lciwjbtbadjpkooufsvx` — **read-only** via `tenkaraQuery()` from `@/lib/tenkara-readonly`. Tables read: `materials`, `suppliers`, `quotes`, `supplier_catalog_materials`, `organizations` |
| Email staging | Missive REST API — staging drafts only, never sends. Client at `src/lib/missive.ts` refuses `send:true` and `from_field` at both compile-time (TS) and runtime (`SAFETY_BANNED_KEYS`). Team ID `bc15c08a-b298-429f-85c0-fda6833c48f9` (Auto Outbox Testing). Auth: `MISSIVE_API_TOKEN` PAT |
| Slack | `@slack/web-api` bot, channels DM'd per agent. Token: `SLACK_BOT_TOKEN` |
| Storage | Supabase Storage buckets `quote-revalidation-csvs`, `lead-scanner-exports`. Signed URLs, 7d TTL |
| Triggers | Vercel cron → `GET /api/cron?slug=<agent-slug>` with `Authorization: Bearer $CRON_SECRET` (also the manual-trigger path) |
| Observability | Each agent writes to `agent_runs` (status, summary, items_processed) + `agent_run_events` (per-step log lines). Surface at `/work/runs` |

### Standing safety invariants (verbatim, must hold across every agent)
1. **No emails are ever sent automatically.** Missive client only stages drafts; operator clicks Send manually in Missive UI.
2. **No writes to Tenkara prod.** Service role for Tenkara is not configured anywhere; only the read-only client is wired.
3. **All writes land in the OA Supabase project.**
4. **`from_field` stays empty on every draft.** Operator picks the sender in Missive before sending.

---

## Agents 01 – 11

Status as of 2026-05-27: **10 shipped, 1 deferred (09)**.

### Agent 01 — Ping
- **Status:** ✅ shipped · `agent-01-ping` · scheduled
- **File:** `src/agents-runtime/agents/ping.ts`
- **Role:** Infrastructure heartbeat. POSTs to `/api/runs` on schedule to verify SuperAgent ↔ Ops Assistants pipeline is alive. No business logic.
- **Reads:** nothing
- **Writes:** `agent_runs`, `agent_run_events`
- **External APIs:** none
- **Trigger:** cron
- **Failure modes to test:** does it complete; does the run row land in `agent_runs`; does it spam if cron over-triggers
- **Training wheels:** off

---

### Agent 02 — Quote Revalidation
- **Status:** ✅ shipped · `agent-02-revalidation` · `cron: 0 3 * * 1` (Mondays 03:00 UTC)
- **File:** `src/agents-runtime/agents/quote-revalidation/index.ts`, `config.ts`, `drafter.ts`
- **Role:** Weekly sweep across all Tenkara client orgs. Finds expired/expiring quotes, classifies each by client (active vs ghost), drafts **one Missive email per (client × supplier) group**, uploads a CSV to Supabase Storage, posts a Slack summary with @-mentions to Rosie/Mildred/Andrea.
- **Reads:** Tenkara prod (`quotes`, `materials`, `suppliers`, `organizations`)
- **Writes:** Missive drafts (via API), `draft_references` (OA), Supabase Storage `quote-revalidation-csvs`, Slack message
- **External APIs:** Missive POST `/drafts`, Slack `chat.postMessage`, Supabase Storage signed URL
- **Trigger:** cron (weekly) + manual
- **Failure modes to test:** ghost vs active client classification correctness; what happens if a supplier has multiple overdue quotes in same client (should be a single draft); Missive draft creation rate limits; Slack channel delivery
- **Training wheels:** **on** · stamp_of_approval: off

---

### Agent 03 — Lead Creator
- **Status:** ✅ shipped · `agent-03-lead-creator` · manual / cron-ready
- **File:** `src/agents-runtime/agents/lead-creator/index.ts`
- **Role:** For each newly-added Tenkara material, surfaces candidate suppliers from the existing supplier graph (quote history + uploaded catalogs) into `leads_in_flight @ stage=raw` for human enrichment review. Capped at `MAX_NEW_LEADS_PER_RUN=50`. Optional Browserbase external discovery is gated by `BROWSERBASE_API_KEY` (currently unset → existing-DB only mode).
- **Reads:** Tenkara prod (`materials` added since cursor, `supplier_catalog_materials`, `quotes`, `suppliers`); OA `leads_in_flight` for dedup mirror
- **Writes:** OA `leads_in_flight` (insert rows at `stage=raw`); `agent_state` cursor (last material scan time)
- **External APIs:** Browserbase (optional; not active in current env)
- **Trigger:** manual / cron-ready
- **Failure modes to test:** materials-window cursor advancing; dedup against existing leads; org_id wiring (all 50 current raw rows have org_id populated); cap respected
- **Training wheels:** off · stamp_of_approval: on

---

### Agent 04 — Outreach
- **Status:** ✅ shipped · `agent-04-outreach` · manual
- **Files:** `src/agents-runtime/agents/outreach/index.ts`, `drafter.ts`
- **Role:** Composes outreach emails for `stage=enriched` leads, stages them as Missive drafts (never sends), and promotes leads to `stage=ready_for_outreach`. Deterministic templates in v1 — no LLM. Cap `OUTREACH_MAX_DRAFTS_PER_RUN=5` per run.
- **Reads:** OA `leads_in_flight` (stage=enriched, status=active); `org_default_operators` (assigned_operator); active/ghost client classification from `quote-revalidation/config.ts`
- **Writes:** Missive drafts; OA `draft_references` (insert with status='staged'); OA `leads_in_flight.payload.outreach` (set), `leads_in_flight.stage='ready_for_outreach'`
- **External APIs:** Missive POST `/drafts` (with `add_to_team_inbox=true`)
- **Trigger:** manual
- **Failure modes to test:**
  - active vs ghost classification: ghost-mode drafts must NOT mention any other client's name (Agent 10 catches this)
  - dedup: re-running shouldn't double-stage the same (agent_id, supplier_id, material_id, status=staged) draft
  - email format validation (`format_valid` flag on `payload.supplier_contact_email`)
  - what happens when `org_default_operators` row missing → `assigned_operator=null` (Agent 10 flags it)
  - cap enforced
- **Training wheels:** **on** · stamp_of_approval: on

---

### Agent 05 — Marketplace Validation
- **Status:** ✅ shipped · `agent-05-marketplace-validation` · manual
- **File:** `src/agents-runtime/agents/marketplace-validation/index.ts`
- **Role:** Re-verifies `payload.signal=catalog_match` leads against Tenkara's current `supplier_catalog_materials`. Flags `payload.catalog_drift='no_longer_listed'` when a supplier has dropped a material we sourced from them. Cap 50.
- **Reads:** OA `leads_in_flight` (filter `payload->>signal=eq.catalog_match`, status=active); Tenkara `supplier_catalog_materials`
- **Writes:** OA `leads_in_flight.payload.catalog_drift`, `leads_in_flight.payload.catalog_validation` (timestamp + run_id)
- **External APIs:** none (Tenkara read-only)
- **Trigger:** manual
- **Failure modes to test:** correct flagging when supplier still lists vs no longer lists; idempotency (rerun shouldn't double-flag); cap enforced; behavior on leads with no catalog_match signal (should skip)
- **Training wheels:** off · stamp_of_approval: on

---

### Agent 06 — Data Enrichment
- **Status:** ✅ shipped · `agent-06-enrichment` · manual
- **File:** `src/agents-runtime/agents/data-enrichment/index.ts`, plus `enrich.ts` helpers
- **Role:** Pre-outreach enrichment. Sweeps `stage=raw` leads (top 25 by confidence_score desc), probes supplier website + contact email, merges Tenkara supplier metadata, then either promotes to `stage=enriched` (if outreach_ready) or leaves at raw with `payload.enrichment_blocked_reason`.
- **Reads:** OA `leads_in_flight` (stage=raw); Tenkara `suppliers` for metadata
- **Writes:** OA `leads_in_flight.payload.enrichment`, flattened fields `supplier_phone`, `country`, `completeness_score`; promotes `stage` to `enriched`
- **External APIs:** none in v1 (no live website probe); deterministic enrichment from Tenkara metadata
- **Trigger:** manual
- **Failure modes to test:** the 25/run cap; idempotency (rerun on already-enriched leads shouldn't regress them); enrichment_blocked_reason set on raws that can't promote; that `payload.outreach_ready=true` correlates with promotion
- **Training wheels:** off · stamp_of_approval: on

---

### Agent 07 — Escalation
- **Status:** ✅ shipped · `agent-07-escalation` · manual
- **File:** `src/agents-runtime/agents/escalation/index.ts`
- **Role:** Sweeps stale leads (`status=active` AND `updated_at < now - 14d`) and opens a `cases` row for the assigned operator. Bumps lead `status='dropped'` with `drop_reason='escalated_to_case'` and `payload.escalation` metadata. Cap 25.
- **Reads:** OA `leads_in_flight`, `org_default_operators` (with OOO backup logic)
- **Writes:** OA `cases` (insert, type='other', org_id NOT NULL — leads with no org_id are skipped); `leads_in_flight.status`, `drop_reason`, `payload.escalation`
- **External APIs:** none
- **Trigger:** manual
- **Failure modes to test:** the 14d threshold; behavior on leads with no org_id (must skip, not error); OOO backup operator resolution; case `recommended_action` varies by lead stage; idempotency (lead status flip makes it not re-pick)
- **Training wheels:** off · stamp_of_approval: on

---

### Agent 08 — Email Scanner ⭐ newest
- **Status:** ✅ shipped · `agent-08-email-scanner` · manual
- **File:** `src/agents-runtime/agents/email-scanner/index.ts`, plus read helpers in `src/lib/missive.ts`
- **Role:** Scans Missive `team_all` inbox for messages whose sender email matches any supplier we have outreach to. Match is by **sender email, not thread id**, so suppliers starting a fresh email chain are still caught. Flags replies onto `draft_references.metadata.reply_detected` and `leads_in_flight.payload.supplier_reply`. Never sends.
- **Reads:** Missive `/conversations?team_all=...` (limit 50), Missive `/conversations/{id}/messages?limit=10` (Missive's hard cap); OA `draft_references` (non-discarded) joined to `leads_in_flight.payload.supplier_contact_email`
- **Writes:** OA `draft_references.metadata.reply_detected` (jsonb with detection_mode=same_thread|fresh_thread, message_id, conv_id, run_id, sender, timestamp); OA `leads_in_flight.payload.supplier_reply`; `agent_state` cursor (key=`team_<id>_last_scan`)
- **External APIs:** Missive GET `/conversations`, GET `/conversations/{id}/messages`
- **Trigger:** manual (cron-ready, not yet scheduled — training wheels on)
- **Failure modes to test:**
  - **Same-thread reply:** supplier replies inside the draft's conversation → detection_mode=`same_thread`
  - **Fresh-chain reply:** supplier composes new email to us → detection_mode=`fresh_thread`
  - Cursor advance is correct (max `last_activity_at` observed)
  - Drafts (`m.draft=true`) are skipped (Missive's /messages endpoint excludes them anyway)
  - Stale-message skip (`m.created_at <= cursor`)
  - Multi-reply: one supplier with multiple drafts gets stamped on all matching draft_references; same reply within one run doesn't double-stamp (matchedDraftIds set)
- **Training wheels:** **on** · stamp_of_approval: on
- **Known caveat:** typo in summary string ("replyies"). Cosmetic.

---

### Agent 09 — Doc Refresh
- **Status:** ⏳ **deferred** (intentionally — sequenced after big E2E test on the rest of the fleet)
- **File:** not yet built
- **Role (per spec):** Composes Missive drafts asking suppliers to refresh out-of-date docs (specs, COAs, etc). Like Agent 02, it's a draft-producer.
- **Why deferred now:** another draft-producer would muddy the test signal for Agent 08 reply detection. Will be picked up after the test passes. See "Why 09 was deferred" writeup.
- **Failure modes to define when built:** which docs trigger a refresh; per-supplier cap; ghost-mode handling

---

### Agent 10 — QA Outreach
- **Status:** ✅ shipped · `agent-10-qa-outreach` · manual
- **File:** `src/agents-runtime/agents/outreach-qa/index.ts`
- **Role:** Lints staged drafts (older than 1h, younger than 7d) for problems an operator should see before sending. Writes findings to `draft_references.metadata.qa_findings = Array<{severity, code, message}>`. Does NOT change draft status — only flags.
- **Rules (each runs independently, all 5 fire on every draft):**
  1. `placeholders_in_body` (error) — matches `/\{\{[^}]+\}\}|\{[A-Z_][A-Z0-9_]*\}|<<[^>]+>>|TBD|TODO|XXX/g`
  2. `placeholders_in_subject` (error) — same regex on subject
  3. `missing_operator` (warn) — `assigned_operator IS NULL`
  4. `empty_body` (error) — body shorter than 50 chars
  5. `ghost_brand_leak` (error) — ghost-mode draft mentions any *other* client name (Aurora, Bobber, Vita Organica, McGinley, Nutripro, PharmaLab, Sphere, Ulo, Tenkara)
- **Reads:** OA `draft_references` (status=staged, created_at between now-7d and now-1h)
- **Writes:** OA `draft_references.metadata.qa_findings`, `qa_run_id`, `qa_ran_at`. Cap 100/run.
- **External APIs:** none
- **Trigger:** manual
- **Failure modes to test:** each of the 5 rules fires correctly on a known-bad draft; clean drafts get `qa_findings=[]`; grace period of 1h respected; rerun overwrites prior findings (idempotent)
- **Training wheels:** off · stamp_of_approval: on

---

### Agent 11 — Lead Scanner CSV Push
- **Status:** ✅ shipped · `agent-11-lead-scanner-csv-push` · manual / daily-cron-ready
- **File:** `src/agents-runtime/agents/lead-scanner-csv-push/index.ts`
- **Role:** Daily per-supplier CSV handoff to Andrew (Tenkara eng). Reads `dropped`/`terminal` leads, groups by supplier, uploads a CSV to Supabase Storage, posts a Slack DM with the signed link. Status tracked in `lead_scanner_exports` (dedup: don't re-export same supplier within 7 days). Below-noise-floor suppliers (mean confidence < threshold) are filtered out.
- **Reads:** OA `leads_in_flight` (status in dropped/terminal), `lead_scanner_exports` for dedup
- **Writes:** Supabase Storage `lead-scanner-exports/*.csv`; Slack DM; OA `lead_scanner_exports` insert
- **External APIs:** Slack `chat.postMessage`, Supabase Storage signed URL
- **Trigger:** manual / daily-cron-ready
- **Failure modes to test:** dedup window (same supplier within 7d should skip); noise-floor filter; signed-URL TTL; Slack failure handling

---

## Pipeline view

```
                    ┌──────────────┐
                    │  Agent 03    │  raw leads from new materials
                    │ Lead Creator │
                    └──────┬───────┘
                           │ stage=raw
                           ▼
                    ┌──────────────┐
                    │  Agent 06    │  probe + merge metadata
                    │  Enrichment  │
                    └──────┬───────┘
                           │ stage=enriched
                           ▼
                    ┌──────────────┐
                    │  Agent 04    │  compose + stage Missive draft
                    │   Outreach   │
                    └──────┬───────┘
                           │ stage=ready_for_outreach, draft_ref staged
                           ▼
              ┌────────────┴────────────┐
              │                         │
       ┌──────▼───────┐         ┌───────▼───────┐
       │  Agent 10    │         │   Operator    │
       │ QA Outreach  │         │ clicks Send   │
       └──────────────┘         │  in Missive   │
       (lints findings)         └───────┬───────┘
                                        │ message goes out
                                        ▼
                                 ┌──────────────┐
                                 │  Supplier    │
                                 │   replies    │
                                 └──────┬───────┘
                                        │
                                        ▼
                                 ┌──────────────┐
                                 │  Agent 08    │  flag reply on draft + lead
                                 │ Email Scanner│
                                 └──────────────┘

   side-channels (not in the new-lead loop):
   - Agent 02: weekly quote revalidation drafts (similar shape to Agent 04)
   - Agent 05: catalog drift flags
   - Agent 07: 14d stale-lead → case escalation
   - Agent 11: daily dropped-lead CSV to Andrew
   - Agent 01: infrastructure ping
```

---

## Suggested test plan scaffold

A minimum-viable E2E pass should exercise the spine in order:

1. **Pre-state snapshot.** Record current row counts: `leads_in_flight` by stage, `draft_references` by status, `cases`, `lead_scanner_exports`, `agent_state`.
2. **Agent 03** — trigger manually, verify N raw leads land with `org_id` populated, no Tenkara writes.
3. **Agent 06** — trigger, verify 25/run cap, some promote to enriched, the rest get `enrichment_blocked_reason`.
4. **Agent 04** — trigger, verify ≤5 Missive drafts staged with empty `from_field`, `add_to_team_inbox=true`, `draft_references` row created, lead → `ready_for_outreach`. **Spot-check the drafts in Missive UI.**
5. **Agent 10** — trigger after the 1h grace, verify `qa_findings` populated; intentionally seed a bad draft (placeholder in body) and confirm rule fires.
6. **Send one draft manually from Missive UI**, ideally to an address you control so you can reply.
7. **Reply from supplier address (same thread)** — trigger Agent 08, verify `reply_detected.detection_mode=same_thread` on the draft + `supplier_reply` on the lead.
8. **Reply from supplier address (fresh email)** — compose a new message to the team_inbox, trigger Agent 08, verify `detection_mode=fresh_thread`.
9. **Agent 05** — needs at least one lead with `payload.signal=catalog_match`; trigger and verify catalog_drift flag.
10. **Agent 07** — needs a lead with `updated_at` >14d (or temporarily backdate one in a scratch row); trigger and verify case opened + lead dropped.
11. **Agent 11** — trigger and verify CSV in storage + Slack DM + dedup on rerun.
12. **Agent 02** — trigger manually (don't wait for Monday cron); verify CSV + Slack + ≥1 draft.
13. **Agent 01** — confirm it's already running on cron from the last 24h of `agent_runs`.
14. **Post-state diff.** Compare to step 1's snapshot. Every change should be attributable to a specific run.

### Safety checks to run alongside
- `git grep "send.*true"` in `src/lib/missive.ts` callers — should return zero matches
- Confirm no env var named `TENKARA_SERVICE_ROLE_KEY` or similar exists in Vercel
- Spot check 3 random draft_references rows: `metadata.outreach_mode` should be `active` or `ghost`, never blank
- Tail `agent_run_events` while triggering: look for any `level=error`

---

## Quick-reference: env vars by agent

| Var | Used by | Required? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | all | yes |
| `TENKARA_SUPABASE_URL`, `TENKARA_SUPABASE_ANON_KEY` | 02, 03, 05, 06 | yes |
| `MISSIVE_API_TOKEN` | 02, 04, 08 | yes |
| `SLACK_BOT_TOKEN` | 02, 11 | yes |
| `CRON_SECRET` | trigger path (all) | yes |
| `BROWSERBASE_API_KEY` | 03 | optional (off in current env) |
| `OUTREACH_MAX_DRAFTS_PER_RUN` | 04 | optional (default 5) |

---

## Manual trigger recipe

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://ops-agents-vu4o.vercel.app/api/cron?slug=agent-08-email-scanner"
```

Replace the slug for any other agent. Response includes `runId` for log lookup.

## Run inspection

```sql
-- last 10 runs across the fleet
select a.slug, ar.status, ar.summary, ar.items_processed, ar.run_finished_at
from agent_runs ar join agents a on a.id = ar.agent_id
order by ar.run_finished_at desc nulls last
limit 10;

-- events for a specific run
select level, step, message, data
from agent_run_events
where run_id = '<RUN_ID>'
order by at asc;
```
