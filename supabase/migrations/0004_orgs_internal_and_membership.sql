-- Add internal/testing flag for orgs (e.g. "Aurora (Testing Org)", "Tenkara (Internal Sourcing)").
alter table public.orgs add column if not exists is_internal boolean not null default false;

-- Per-org role assignment for users (Phase A: §8.2 + §8.3 foundation).
-- A user can have one role per org. Global admin/monitor stay in user_roles without an org row here.
create table if not exists public.user_org_assignments (
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role text not null references public.roles(name),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.users(id),
  primary key (user_id, org_id)
);
create index if not exists user_org_assignments_org_idx on public.user_org_assignments(org_id);

alter table public.user_org_assignments enable row level security;
drop policy if exists user_org_assignments_read on public.user_org_assignments;
create policy user_org_assignments_read on public.user_org_assignments
  for select to authenticated using (
    user_id = auth.uid() or public.has_any_role(array['admin','ops_lead','monitor'])
  );

-- Drop the Meridian Foods seed row (replaced by real prod orgs synced in script).
delete from public.orgs where slug = 'meridian-foods';
