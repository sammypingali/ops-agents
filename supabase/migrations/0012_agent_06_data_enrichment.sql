-- Migration 0012 - register Agent 06 (Data Enrichment).
-- Embedded, manual-only first run (same pattern as Agent 03). The full spec
-- has a reply-driven mode that depends on Agent 08 (Email Scanner); the v1
-- ported here is the pre-outreach enrichment slice — it sweeps raw leads,
-- probes the supplier website, validates the contact email, and bumps the
-- row to stage='enriched' for human review.

insert into public.agents (slug, name, description, runtime, training_wheels_mode, stamp_of_approval, schedule_cron, prompt)
values (
  'agent-06-enrichment',
  'Agent 06 - Data Enrichment',
  'Pre-outreach enrichment. Sweeps stage=raw leads, probes supplier website + contact email, merges Tenkara supplier metadata, then promotes to stage=enriched for human review.',
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
