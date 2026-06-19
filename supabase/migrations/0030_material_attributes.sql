-- Migration 0030 - Per-material report attributes (Savings "freight" report).
--
-- Manual values ops enter for a client's material so the freight / within-target
-- savings report can show material cost vs CIF/freight separation. None of this
-- lives in Tenkara, so it's captured here. One row per (org, material, unit);
-- attaches to the savings report line by the same material_id|unit key.
--
-- Standing invariants: writes land in OA only; Tenkara prod stays read-only.
-- Service-role writes (server actions) bypass RLS; reads are org-scoped like the
-- other org tables (see 0016 / 0021 / 0029).

create table if not exists public.material_attributes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenkara_material_id text not null,
  unit text not null default '',        -- '' when the line has no unit
  moq text,                             -- free text, e.g. "1000 kg (4 drums x 250-kg)"
  exw_cost numeric,                     -- total product (EXW) cost per unit
  freight_ocean numeric,                -- ocean freight estimate per unit
  freight_ocean_days text,              -- transit, e.g. "30-40 days"
  freight_air numeric,                  -- air freight estimate per unit
  freight_air_days text,
  tariff_duty numeric,                  -- tariff / duty estimate per unit
  facility_certs text,                  -- e.g. "ISO 22000, Kosher, Organic"
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  unique (org_id, tenkara_material_id, unit)
);

create index if not exists material_attributes_org_idx
  on public.material_attributes (org_id);

-- ------------------------------------------------------------
-- RLS: same org-scoped read gating as client_material_orders (0029).
-- ------------------------------------------------------------
alter table public.material_attributes enable row level security;

drop policy if exists material_attributes_read on public.material_attributes;
create policy material_attributes_read on public.material_attributes for select to authenticated
  using (
    public.has_any_role(array['admin','ops_lead','monitor'])
    or public.user_has_org_access(org_id)
  );
