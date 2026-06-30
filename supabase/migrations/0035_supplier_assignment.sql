-- Manual supplier → operator assignment, grain supplier × client (org). Lets ops
-- claim a supplier so the agent routes that client's outreach/replies to them
-- instead of the sticky-random default. Internal only; no Tenkara coupling.
-- Idempotent.

create table if not exists public.supplier_assignment (
  supplier_id text not null,                              -- Tenkara supplier_id
  org_id uuid not null references public.orgs(id) on delete cascade,
  operator_id uuid not null references public.users(id),
  assigned_by uuid references public.users(id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, org_id)
);

create index if not exists supplier_assignment_org_idx on public.supplier_assignment(org_id);
create index if not exists supplier_assignment_operator_idx on public.supplier_assignment(operator_id);

-- Internal table: gate reads/writes behind auth; server actions use the
-- service-role client (which bypasses RLS) and enforce role checks in code.
alter table public.supplier_assignment enable row level security;
do $$ begin
  create policy supplier_assignment_authenticated on public.supplier_assignment
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
