-- Move all cron schedules to America/New_York for the East-Coast ops team.
-- Daily/weekly anchors land in the morning ET; sub-daily cadences keep their
-- interval but switch reference timezone.
--
-- Agent 11 anchors at 09:00 ET = 06:00 PT so Andrew (Tenkara eng, West Coast)
-- still receives the CSV at the start of his workday.
-- Fleet summary stays an end-of-day recap at 18:00 ET.

update public.agents set schedule_tz = 'America/New_York' where slug = 'agent-01-ping';

update public.agents set schedule_cron = '0 7 * * 1',  schedule_tz = 'America/New_York' where slug = 'agent-02-revalidation';
update public.agents set schedule_cron = '0 */4 * * *', schedule_tz = 'America/New_York' where slug = 'agent-03-lead-creator';
update public.agents set schedule_cron = '0 * * * *',   schedule_tz = 'America/New_York' where slug = 'agent-04-outreach';
update public.agents set schedule_cron = '0 7 * * *',   schedule_tz = 'America/New_York' where slug = 'agent-05-marketplace-validation';
update public.agents set schedule_cron = '0 */2 * * *', schedule_tz = 'America/New_York' where slug = 'agent-06-enrichment';
update public.agents set schedule_cron = '0 */6 * * *', schedule_tz = 'America/New_York' where slug = 'agent-07-escalation';
update public.agents set schedule_cron = '*/30 * * * *', schedule_tz = 'America/New_York' where slug = 'agent-08-email-scanner';
update public.agents set schedule_cron = '15 * * * *',  schedule_tz = 'America/New_York' where slug = 'agent-10-qa-outreach';
update public.agents set schedule_cron = '0 9 * * *',   schedule_tz = 'America/New_York' where slug = 'agent-11-lead-scanner-csv-push';
update public.agents set schedule_cron = '0 18 * * *',  schedule_tz = 'America/New_York' where slug = 'agent-fleet-summary';
