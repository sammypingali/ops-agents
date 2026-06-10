-- Migration 0022 - Client Profile becomes research-generated.
--
-- Reframe from "ops fill a form" to "the agent researches + summarizes".
-- The agent combs the open web, pulls the client's Tenkara data and any
-- client_settings entries ops typed, folds in uploaded info, and writes a
-- summarized profile that ops can edit when something is wrong.
--
-- client_settings stays (optional ops-entered inputs feed the generation) but
-- is no longer the source of truth. All writes land in OA.

-- Research outputs on the agent-owned profile (summary text already exists from 0021).
alter table public.client_profiles add column if not exists highlights jsonb not null default '[]'::jsonb;   -- short bullet facts
alter table public.client_profiles add column if not exists sources jsonb not null default '[]'::jsonb;      -- [{title,url}] web citations
alter table public.client_profiles add column if not exists manual_override boolean not null default false;  -- set when ops edit; auto-refresh skips, explicit regen clears
alter table public.client_profiles add column if not exists last_generated_at timestamptz;

-- ============================================================
-- client_uploads - info ops add for a client; folded into generation + summarized.
-- ============================================================
create table if not exists public.client_uploads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','file')),
  file_path text,            -- storage path when kind='file'
  file_name text,
  content_text text,         -- pasted note, or extracted text for text/markdown files
  summary text,              -- per-item summary the agent writes
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists client_uploads_org_idx on public.client_uploads(org_id, created_at desc);

alter table public.client_uploads enable row level security;
drop policy if exists client_uploads_read on public.client_uploads;
create policy client_uploads_read on public.client_uploads for select to authenticated
  using (
    public.has_any_role(array['admin','ops_lead','monitor'])
    or public.user_has_org_access(org_id)
  );

-- Storage bucket for uploaded client info (private). Supabase manages the table.
insert into storage.buckets (id, name, public) values ('client-uploads', 'client-uploads', false)
on conflict (id) do nothing;

-- Refresh the agent description to the research model.
update public.agents set description =
  'Researches and maintains a client profile per org. Combs the open web (Anthropic web_search), pulls the client''s Tenkara data + any client_settings entries + uploaded info, and summarizes it into client_profiles. Generated on demand (per org) and on upload; an hourly run lightly refreshes stale profiles. Ops can edit to correct it (manual_override). OA writes only; never stages drafts.'
where slug = 'agent-12-client-profile';
