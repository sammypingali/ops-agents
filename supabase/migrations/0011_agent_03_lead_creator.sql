-- Migration 0011 - register Agent 03 (Lead Creator).
-- Embedded, no schedule_cron yet (manual-only for first test, just like Agent 11).
-- A '0 */4 * * *' cron is the eventual target but blocked by Vercel Hobby's
-- daily-cron limit; we'll switch when we move to an external scheduler.

insert into public.agents (slug, name, description, runtime, training_wheels_mode, stamp_of_approval, schedule_cron, prompt)
values (
  'agent-03-lead-creator',
  'Agent 03 - Lead Creator',
  'Cron-driven scout. For each newly-added Tenkara material, surfaces candidate suppliers from the existing supplier graph (quote history + uploaded catalogs) into leads_in_flight @ stage=raw for human enrichment review.',
  'embedded',
  false,
  true,
  null,
  null
)
on conflict (slug) do update set
  runtime = 'embedded',
  name = excluded.name,
  description = excluded.description;
