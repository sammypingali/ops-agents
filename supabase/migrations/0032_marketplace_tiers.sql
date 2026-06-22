-- Structured tier pricing for marketplace re-check findings (Agent 05).
-- Lets a finding carry every visible pack-size/volume-break tier plus a
-- normalized best per-unit price, so bulk totals stop reading like unit prices.
alter table public.marketplace_check_findings
  add column if not exists unit_price numeric,
  add column if not exists tiers jsonb not null default '[]'::jsonb;
