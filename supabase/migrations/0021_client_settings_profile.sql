-- Migration 0021 - Client Settings + Client Profile (Agent 12).
--
-- Two org-scoped tables:
--   client_settings  - ops-curated inputs, finalized per client. The agent
--                      only reads these once status='finalized'.
--   client_profiles  - agent-maintained "rendition" surfaced on each org tab.
--                      The agent copies the finalized settings in, derives a
--                      client_type, and snapshots OA activity so ops can
--                      identify a client at a glance.
--
-- Standing invariants hold: all writes land in OA; the agent never touches
-- Tenkara prod. Service-role writes (server actions, agent runtime) bypass RLS;
-- reads are gated org-scoped like the other org tables (see 0016).

-- ============================================================
-- client_settings - ops fill these in, then finalize.
-- ============================================================
create table if not exists public.client_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  outreach_mode text not null default 'active' check (outreach_mode in ('active','ghost','skip')),
  ghost_brand text,                         -- required when outreach_mode='ghost'
  priority_tier text not null default 'standard' check (priority_tier in ('standard','priority','vip')),
  primary_contact_name text,
  primary_contact_email text,
  sourcing_notes text,
  status text not null default 'draft' check (status in ('draft','finalized')),
  finalized_at timestamptz,
  finalized_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- client_profiles - agent-owned. One row per org once its settings finalize.
-- ============================================================
create table if not exists public.client_profiles (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  client_type text not null check (client_type in ('active','ghost','skip','prospect')),
  summary text,                             -- one-line rendition for the tab header
  profile jsonb not null default '{}'::jsonb, -- copied settings + activity snapshot
  settings_synced_at timestamptz,           -- the source settings.updated_at this build reflects (staleness check)
  last_built_at timestamptz,
  last_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- RLS: same org-scoped read gating as leads_in_flight et al (0016).
-- user_has_org_access() is defined in 0016.
-- ------------------------------------------------------------
alter table public.client_settings enable row level security;
alter table public.client_profiles enable row level security;

drop policy if exists client_settings_read on public.client_settings;
create policy client_settings_read on public.client_settings for select to authenticated
  using (
    public.has_any_role(array['admin','ops_lead','monitor'])
    or public.user_has_org_access(org_id)
  );

drop policy if exists client_profiles_read on public.client_profiles;
create policy client_profiles_read on public.client_profiles for select to authenticated
  using (
    public.has_any_role(array['admin','ops_lead','monitor'])
    or public.user_has_org_access(org_id)
  );

-- ============================================================
-- Register Agent 12. Profiles rebuild inline when ops change a client's
-- settings; this hourly sweep is the backstop that re-syncs any drift.
-- ============================================================
insert into public.agents (slug, name, description, runtime, training_wheels_mode, stamp_of_approval, schedule_cron, schedule_tz, prompt)
values
  (
    'agent-12-client-profile',
    'Agent 12 - Client Profile',
    'Maintains a client_profiles row per org. Rebuilds the moment ops change a client''s settings (inline from the settings form); an hourly sweep re-syncs any drift. Copies the current settings in, derives client_type (active/ghost/skip/prospect), and snapshots OA activity. Read/write on OA only; never touches Tenkara or Missive. Surfaced on each org''s Client Profile tab.',
    'embedded', false, true, '0 * * * *', 'America/New_York', null
  )
on conflict (slug) do update set
  runtime = 'embedded',
  name = excluded.name,
  description = excluded.description,
  schedule_cron = excluded.schedule_cron,
  schedule_tz = excluded.schedule_tz;
