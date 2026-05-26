-- Phase G2 — storage bucket for QR CSVs + QR agent registration

-- Create the storage bucket. Supabase manages the table; safe to call repeatedly.
insert into storage.buckets (id, name, public)
values ('quote-revalidation-csvs', 'quote-revalidation-csvs', false)
on conflict (id) do nothing;

-- Storage RLS: only service-role writes/reads. We use signed URLs for ops access.
-- (Default Supabase storage policy is "deny" so we don't need to lock down further;
-- the service role bypasses RLS automatically.)

-- Flip Agent 02 to embedded runtime.
update public.agents
set
  runtime = 'embedded',
  schedule_cron = '0 3 * * 1',           -- Mon 3 AM ET (per original config.yaml)
  description = 'Weekly sweep across all Tenkara client orgs. Finds expired/expiring quotes, classifies each by client (active vs ghost), drafts one Missive email per (client × supplier) group with the from_field deliberately empty, uploads a CSV to Supabase Storage, and posts a single Slack summary with @-mentions to Rosie/Mildred/Andrea.'
where slug = 'agent-02-revalidation';
