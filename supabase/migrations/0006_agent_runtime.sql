-- Phase G1 — agent runtime inside Tackle Box
-- Columns to support running agents from within the app (not just receiving runs
-- from SuperAgent). The new state lives on the agents table.

alter table public.agents
  add column if not exists runtime text not null default 'external'
    check (runtime in ('external', 'embedded')),
  add column if not exists prompt text,
  add column if not exists current_run_id uuid references public.agent_runs(id) on delete set null,
  add column if not exists locked_until timestamptz;

-- Agent run logs (live status stream — events appended as the run executes)
create table if not exists public.agent_run_events (
  id bigserial primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  at timestamptz not null default now(),
  level text not null default 'info' check (level in ('info','warn','error','debug')),
  step text,            -- short identifier of the workflow step
  message text not null,
  data jsonb
);
create index if not exists agent_run_events_run_idx on public.agent_run_events(run_id, at);

-- The ping agent — a no-op embedded agent that proves the loop end-to-end.
-- Uses the final 'agent-01-ping' slug directly so re-running migrations doesn't
-- re-create the legacy 'ping' row (which 0008 would then try to rename into a
-- duplicate of the already-renamed row).
insert into public.agents (slug, name, description, runtime, training_wheels_mode, stamp_of_approval, schedule_cron, prompt)
values (
  'agent-01-ping',
  'Agent 01 - Ping',
  'Infrastructure heartbeat agent. Runs on a schedule and POSTs to /api/runs to verify the SuperAgent ↔ Ops Assistants pipeline is intact. No real workflow logic. Used as the system liveness check.',
  'embedded',
  false,
  true,
  null,
  null
)
on conflict (slug) do update set runtime = 'embedded';

-- Flip the existing Agent 02 to embedded once we port it. Until then, leave it external.
-- (No change here; Phase G2 will flip the row.)
