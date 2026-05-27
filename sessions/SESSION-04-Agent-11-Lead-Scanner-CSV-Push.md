# Session 04 — Agent 11 Lead Scanner CSV Push

## Agents built this session
- **Agent 11 - Lead Scanner CSV Push** — **E2E verified in production**.
  - Run `06e057a6-4f85-4949-9a23-fb00dcd2c5ad` (manual, 2.7s) — `success` with `items_processed=1`.
  - Summary: *Exported 1 supplier CSV to Andrew · skipped 0 as recent · 1 as noisy · 0 Slack failures · Hyalux Biotech (2)*.
  - 3 seeded `leads_in_flight` rows resolved correctly:
    - Hyalux Biotech / Hyaluronic Acid (terminal, 0.82) + Niacinamide (terminal, 0.74) → grouped, CSV uploaded, Slack DM sent (ts `1779842087.313459`).
    - OneOff Labs / Mystery Extract (dropped, 0.22, single lead) → filtered by noise floor (`<2 leads AND mean conf <0.4`).
  - Slack handoff lands in bot↔Andrew DM `D0B69M14GHL` (resolved via `conversations.open` against user ID `U0ACH1LLSEN`). DM ID is overridable via `ANDREW_SLACK_DM_ID`.
  - CSV stored at `lead-scanner-csvs/2026-05-27/Hyalux_Biotech-1779842086692.csv` (signed URL, 7-day expiry).
  - Code: [`src/agents-runtime/agents/lead-scanner-csv-push/index.ts`](../src/agents-runtime/agents/lead-scanner-csv-push/index.ts), [`csv-builder.ts`](../src/agents-runtime/agents/lead-scanner-csv-push/csv-builder.ts)

### v1 trims (agreed up-front)
- Supplier-level dedup over a rolling 7-day window (no `lead_id` column yet — see Session 05).
- Noise floor: skip suppliers with `<2` leads when mean confidence `<0.4`.
- No Slack ✅-reaction listener — POST and immediately mark `sent`.
- No 24h/72h follow-up sweep.
- No `schedule_cron` yet — manual-only first.

## Infra / platform changes
- **Migration `0009_agent_11_lead_scanner.sql`** — creates private `lead-scanner-csvs` storage bucket and registers the agent row (`runtime=embedded`, `stamp_of_approval=true`).
- **`src/lib/storage.ts`** — `uploadCsvAndSign` generalized to accept an optional `bucket` parameter; defaults preserved for Agent 02.
- **`src/app/api/cron/route.ts`** — added `?slug=<agent-slug>` ad-hoc trigger (still gated on `CRON_SECRET`). Lets us fire a single agent without standing up a new endpoint or fighting the SSR cookie format on `/api/agents/run`.
- **`package.json`** — moved `pg` from `devDependencies` to `dependencies`. It's used at runtime in `src/lib/tenkara-readonly.ts`; the misplacement silently failed production installs whenever `NODE_ENV=production` skipped dev deps.
- **Removed** stub `scripts/trigger-agent-11.ts` — imported a non-existent `ws` module and was breaking the production typecheck.

## Verification
- Seeded 3 leads into `leads_in_flight` in OA Supabase.
- Triggered live: `GET /api/cron?slug=agent-11-lead-scanner-csv-push` with `Authorization: Bearer $CRON_SECRET`.
- Confirmed in DB: 1 `lead_scanner_exports` row, `status='sent'`, `slack_message_ts` populated.
- Confirmed in Slack: DM with CSV link delivered to Andrew.
- Hard constraints honored: no emails, no Tenkara prod writes, OA writes only.

## v1.1 follow-ups (parked)
- **Swap supplier-level dedup → lead_id-based** once Session 05 adds the `lead_id` column to `lead_scanner_exports`. Current behavior excludes whole suppliers exported in the last 7 days, which can mask new leads at known suppliers.
- **Slack ✅-reaction listener** so Andrew's confirmation flips `lead_scanner_exports.status` automatically (currently set to `sent` optimistically on POST).
- **24h / 72h follow-up sweep** to nudge unacknowledged exports.
- **Schedule.** Once the above feels stable, add `schedule_cron` and slot into the daily `0 3 * * *` cron window (or external scheduler if we want a different cadence).

## Agents pending
| # | Agent | Status | Next action |
|---|-------|--------|-------------|
| 03 | Lead Creator | spec received | Build after Session 05 schema reconciliation |
| 04 | Outreach | spec received | Sequence per spec doc |
| 05 | Marketplace Validation | spec received | Sequence per spec doc |
| 06 | Data Enrichment | spec received | Sequence per spec doc |
| 07 | Escalation | spec received | Sequence per spec doc |
| 08 | Email Scanner | spec received | Confirm Missive PAT has `conversations:list` + `conversations:read` scopes first |
| 09 | Doc Refresh | spec received | Sequence per spec doc |
| 10 | QA Outreach | spec received | Sequence per spec doc |
| 11 | Lead Scanner CSV Push | **shipped (v1, manual)** | Schedule + v1.1 follow-ups |

## Blockers carried into next session
- None. Hobby-plan deploy is green; new code paths work end-to-end.

## Suggested next session — Session 05: schema reconciliation
Before Agent 03:
- Add `stage` enum: `('raw' | 'enriched' | 'ready_for_outreach' | 'ready_for_approval' | 'terminal')` to `leads_in_flight`.
- Add `lead_id uuid` column to `lead_scanner_exports`; backfill from existing exports where possible.
- For Agent 08 (Email Scanner) prep: use `email_client_inbox='custom'` and put inbox state in a dedicated `agent_state` table rather than column-bombing `agents`.
