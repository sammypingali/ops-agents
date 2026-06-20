-- Migration 0031 - Add 'login_required' classification to marketplace findings.
--
-- Agent 05 (Marketplace Price Re-check) never logs in or scrapes — it reads
-- public pages via web_search. When a marketplace hides the price behind a
-- sign-in / registration / account wall, that was previously bucketed into
-- 'needs_review'. Split it out so ops can see at a glance which suppliers need
-- a manual marketplace signup/login to pull the price by hand.
--
-- Additive: widens the CHECK to a superset, so existing rows stay valid.

alter table public.marketplace_check_findings
  drop constraint if exists marketplace_check_findings_classification_check;

alter table public.marketplace_check_findings
  add constraint marketplace_check_findings_classification_check
  check (classification in (
    'signal_matches_baseline',
    'signal_diverges',
    'no_signal_found',
    'needs_review',
    'link_broken',
    'login_required'
  ));
