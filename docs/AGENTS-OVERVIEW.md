# Tackle Box — Agents Overview

Reference doc for the agent fleet: what each agent does, what it reads/writes, its safety constraints, and how the pieces fit together.

Source of truth for the in-app descriptions: `public.agents` table (OA project `aiyzpjnvenfmurhyamge`) and `src/lib/agents-spec.ts`. Last updated 2026-05-29 for the flow re-architecture.

---

## The model (read this first)

There are **two kinds of agent**:

- **Scheduled intake agents** — fire on a cron and detect work: **02** (expiries), **03** (new materials), **05** (price changes), **08** (inbound email). Plus **01** (heartbeat) and **07** (escalation/nudge).
- **Called building blocks** — *not* independently scheduled; invoked inline by the intake agents: **04** (outreach drafter), **06** (enrichment), **10** (outreach QA). Their `schedule_cron` is NULL; they remain manually triggerable for backfill.

**Agent 03 is the single driver of the lead pipeline.** Each run it (1) drains the existing backlog — enriches `raw` leads via 06, then lets 04 draft the enriched ones — then (2) scouts suppliers for new materials, then (3) emits a sourcing CSV. Everything is bounded by a ~250s wall-clock budget (Vercel's limit is 300s); leftovers roll to the next run. This is why 04/06 don't need their own cron.

**Surfacing is hybrid:** the top-level Review Queue (`/work/review`) is a per-org **nudge dashboard** ("Org X: 5 new leads, 3 to send") that deep-links into **per-org tabs** (Expiries / Leads / Price Changes / Outreach / Inbound / Cases / Approvals) where the detail and actions live. Cross-org detail is still reachable under the "All …" tabs.

### Standing safety invariants (must hold across every agent)
1. **No emails are ever sent automatically.** The Missive client only stages drafts; an operator clicks Send in Missive.
2. **No writes to Tenkara prod.** Only the read-only client is wired.
3. **All writes land in the OA Supabase project.**
4. **`from_field` stays empty on every draft.** The operator picks the sender.

---

## Shared stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.15 (App Router), TypeScript |
| Runtime | Vercel (300s function maxDuration) |
| Agent runtime | Embedded — each agent `registerAgent({ slug, displayName, description, run(ctx) })`; dispatched by `src/agents-runtime/runtime.ts`. One agent can invoke another via `executeAgentRun()` |
| OA database | Supabase `aiyzpjnvenfmurhyamge` — read/write via `createAdminClient()` |
| Tenkara prod | Supabase `lciwjbtbadjpkooufsvx` — **read-only** via `tenkaraQuery()` |
| Email staging | Missive REST (`src/lib/missive.ts`) — drafts only; refuses `send`/`from_field` at compile + runtime |
| LLM | Anthropic (`@anthropic-ai/sdk`) — Agent 03 scout (web_search), Agent 08 reply drafter, the in-app Ops assistant |
| Slack | `SLACK_BOT_TOKEN` |
| Storage | Supabase Storage (signed URLs, 7d TTL) |
| Triggers | Vercel cron → `GET /api/cron` (auth `Bearer $CRON_SECRET`); single-agent: `?slug=<agent-slug>` |

### Shared building-block functions
- `src/agents-runtime/agents/outreach-qa/lint.ts` → `lintDraft(draft)` — the QA rules.
- `src/lib/draft-staging.ts` → `stageDraft(...)` — Missive create + inline `lintDraft` + `draft_references` insert. Used by 02/04/08.
- `src/agents-runtime/agents/outreach/run-outreach.ts` → `runOutreachForLead(...)` — compose + stage + promote.
- `src/agents-runtime/agents/data-enrichment/run-enrich.ts` → `enrichAndStageLead(...)` — enrich + promote/block.

---

## Schedule (America/New_York)

| Time | Agents |
|---|---|
| 06:00, every 5 min | 01 heartbeat (`*/5`) |
| 07:00 | 02 expiries, 05 price changes |
| 07:00–21:00, every 2h | 03 lead creator (drives 06 → 04) |
| every 30 min | 08 inbound email scan + reply draft |
| 14:00 | 07 escalation + nudge |
| 18:00 | fleet summary |
| — (called) | 04 outreach, 06 enrichment, 10 QA |
| — (paused) | 09 doc refresh, 11 CSV push |

---

## Agents

### Agent 01 — Heartbeat · `*/5 * * * *`
Infrastructure liveness probe; writes an `agent_runs` row. No business logic. (Kept frequent deliberately — a twice-daily heartbeat would hide outages.)

### Agent 02 — Quote Revalidation · daily 07:00
`quote-revalidation/index.ts`. Sweeps Tenkara for expiring/expired quotes, classifies each client (active vs ghost), drafts **one email per (client × supplier)** with its own revalidation copy, runs the **QA lint inline** (`qa_findings` on each `draft_references` row), uploads a CSV, posts a Slack summary. **Debounces** so a given quote isn't re-drafted within 7 days (important now that it runs daily, not weekly). Reads Tenkara; writes Missive drafts + `draft_references` + Storage + Slack.

### Agent 03 — Lead Creator (single driver) · every 2h, 07:00–21:00
`lead-creator/index.ts`. Drives the whole lead pipeline within a budget:
1. **Drain:** pull existing `raw` leads → `enrichAndStageLead` (06) → then `executeAgentRun('agent-04-outreach')` to draft the enriched backlog.
2. **Scout:** for newly-added Tenkara materials, surface graph candidates + web discovery (Anthropic `web_search`, streamed) into `leads_in_flight @ stage=raw`. Known-major-producer pass + marketplace seller drill-in; confidence High/Med/Low = 0.80/0.60/0.35.
3. **CSV:** upload a sourcing CSV of the run's new leads (signed URL on run metadata; download from the per-org Leads tab).
Reads Tenkara + OA; writes `leads_in_flight`, and (via 06/04) `draft_references`. Budget-bounded; leftovers roll to next run.

### Agent 04 — Outreach (called) · not scheduled
`outreach/index.ts` + `run-outreach.ts` + `drafter.ts`. Composes a deterministic (no-LLM) outreach email for an enriched lead, stages it through `stageDraft` (QA inline), promotes the lead to `ready_for_outreach`. Filters: valid email, org classify (active/ghost), prior-relationship skip, dedup. Invoked by Agent 03's drive; also runnable manually. Cap 5/run on the manual sweep.

### Agent 05 — Marketplace Validation / Price Changes · daily 07:00
`marketplace-validation/index.ts`. Re-checks marketplace prices on expiring quotes and writes `marketplace_check_findings` (status `pending_review`). Review-only — ops approves/dismisses on the per-org **Price Changes** tab and applies changes on Tenkara manually. Never drafts email.

### Agent 06 — Data Enrichment (called) · not scheduled
`data-enrichment/index.ts` + `enrich.ts` + `run-enrich.ts`. Promotes `raw` → `enriched` or leaves `raw` with `enrichment_blocked_reason`. **Persistent multi-page contact discovery**: fetches the homepage, follows Contact/About/Sales links + common paths, parses emails/phones (incl. footers), captures a quote/contact-form URL; only stamps `all_contact_channels_invalid` after trying ≥3 pages. Invoked by Agent 03's drive.

### Agent 07 — Escalation + Nudge · daily 14:00
`escalation/index.ts`. Two jobs: (1) opens a `cases` row for leads stale >14d (assigned to the org's primary/backup operator), and (2) posts a **Slack nudge** per org about items pending >3d — staged drafts not sent, reply drafts not sent, leads stuck at `enriched`. The nudge writes nothing; the per-org UI computes its counts live.

### Agent 08 — Email Scanner + Responder · every 30 min
`email-scanner/index.ts` + `reply-drafter.ts`. Scans the Missive team inbox; matches inbound by **sender email** (not thread id). Stamps `reply_detected` on `draft_references` and `supplier_reply` on the lead, then **composes a contextual reply** (Anthropic Sonnet) and stages it via `stageDraft` (deduped on `metadata.reply_draft`). Reply drafts surface on the per-org **Inbound** tab. Never sends. (Kept frequent so replies don't wait ~24h.)

### Agent 09 — Doc Refresh · paused
Not built. A future draft-producer (refresh out-of-date specs/COAs).

### Agent 10 — Outreach QA (called) · not scheduled
`outreach-qa/lint.ts` (rules) + `index.ts` (backstop sweep). Runs **inline at draft creation** inside `stageDraft` for every 02/03/08 flow, writing `metadata.qa_findings`. Rules: placeholders in body/subject (error), missing operator (warn), empty body (error), ghost-brand leak (error). Does not change draft status.

### Agent 11 — Lead Scanner CSV Push · paused (`training_wheels=true`)
`lead-scanner-csv-push/index.ts`. Per-supplier CSV of dropped/terminal leads to Andrew (Tenkara eng). Currently paused.

---

## Pipeline view

```
Agent 03 (driver, every 2h)
  ├─ DRAIN: raw ──[Agent 06 enrich]──► enriched ──[Agent 04 draft + Agent 10 QA]──► ready_for_outreach (Missive draft)
  └─ SCOUT: new Tenkara material ──► raw leads (graph + web)  +  sourcing CSV

        ready_for_outreach ──► 👤 operator reviews & clicks Send in Missive ──► supplier replies
                                                                                      │
                                                          Agent 08 (every 30m) detects + drafts a reply ──► 👤 Send

Side-channels:
  - Agent 02 (daily): expiring-quote revalidation drafts (QA inline)
  - Agent 05 (daily): marketplace price changes → review → manual Tenkara update
  - Agent 07 (daily 2pm): >14d stale → case; + Slack nudge on un-actioned work
  - Agent 01 (*/5): heartbeat
```

The only human gate in the happy path is **Send**. Promote/Drop on the Leads tab remain manual overrides.

---

## Manual trigger / inspection

```bash
# Trigger one agent (e.g. drive the pipeline, or scan inbound):
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://ops-agents-vu4o.vercel.app/api/cron?slug=agent-03-lead-creator"
```

```sql
-- last 10 runs across the fleet
select a.slug, ar.status, ar.summary, ar.items_processed, ar.run_finished_at
from agent_runs ar join agents a on a.id = ar.agent_id
order by ar.run_finished_at desc nulls last limit 10;

-- events for a run
select level, step, message, data from agent_run_events where run_id = '<RUN_ID>' order by at asc;
```

## Env vars

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | all |
| `TENKARA_READONLY_DATABASE_URL` | 02, 03, 05, 06 |
| `MISSIVE_API_TOKEN` | 02, 04, 08 |
| `ANTHROPIC_API_KEY` | 03 (scout), 08 (reply), Ops assistant |
| `SLACK_BOT_TOKEN` | 02, 07, 11 |
| `CRON_SECRET` | trigger path (all) |
| `OUTREACH_MAX_DRAFTS_PER_RUN` | 04 (optional, default 5) |
