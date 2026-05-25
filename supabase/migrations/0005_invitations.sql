-- §5: invite-only signup. Adds invitation + activation tracking to users,
-- a deactivation soft-delete flag, and helper functions for RBAC on invites.

alter table public.users add column if not exists invited_by uuid references public.users(id);
alter table public.users add column if not exists invited_at timestamptz;
alter table public.users add column if not exists last_login_at timestamptz;
alter table public.users add column if not exists deactivated_at timestamptz;
alter table public.users add column if not exists deactivated_by uuid references public.users(id);

-- "Pending" = invited but never logged in (no row in auth.identities password type, but we
-- approximate by checking last_login_at IS NULL AND invited_at IS NOT NULL).
-- "Inactive" = deactivated_at IS NOT NULL.
-- "Active" = otherwise.

-- Who can invite whom (server-side check; client UI mirrors this).
create or replace function public.can_invite_role(actor_id uuid, target_role text) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = actor_id and ur.role = 'admin'
  )
  or (
    target_role in ('ops_operator', 'account_manager')
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = actor_id and ur.role = 'ops_lead'
    )
  );
$$;

-- RLS: admins/lead operators can see the full user list (for the Operators page).
drop policy if exists users_admin_read on public.users;
create policy users_admin_read on public.users for select to authenticated
  using (public.has_any_role(array['admin','ops_lead','monitor']));

-- Allow admin/lead operator to update other users (role changes, deactivation).
-- Actual checks happen in server actions, but RLS keeps the door open via service-role.
