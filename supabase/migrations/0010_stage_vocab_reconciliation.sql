-- Migration 0010 - reconcile leads_in_flight.stage vocabulary with the
-- agent spec (Session 05 schema reconciliation).
--
-- Old vocab (from 0001_init): ('raw_discovery','gap_analysis','approval','exported')
-- New vocab (spec)          : ('raw','enriched','ready_for_outreach','ready_for_approval','terminal')
--
-- Notes:
-- * Existing status column keeps its own enum; we keep stage and status
--   distinct (status = lifecycle of a single lead row; stage = pipeline phase).
-- * 'terminal' appears in both status and stage. That's intentional — once a
--   lead reaches stage='terminal', status will usually be 'terminal' too.

begin;

-- Drop old constraint, remap data, install new constraint.
alter table public.leads_in_flight
  drop constraint if exists leads_in_flight_stage_check;

update public.leads_in_flight set stage = case stage
  when 'raw_discovery' then 'raw'
  when 'gap_analysis'  then 'enriched'
  when 'approval'      then 'ready_for_approval'
  when 'exported'      then 'terminal'
  else stage
end
where stage in ('raw_discovery','gap_analysis','approval','exported');

alter table public.leads_in_flight
  add constraint leads_in_flight_stage_check
  check (stage in ('raw','enriched','ready_for_outreach','ready_for_approval','terminal'));

commit;
