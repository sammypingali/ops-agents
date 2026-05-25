import type { AppRole } from "@/lib/auth";

// Display precedence for role chip when a user holds multiple roles.
const ROLE_PRECEDENCE: AppRole[] = ["admin", "ops_lead", "ops_operator", "account_manager", "monitor"];

export function primaryRole(roles: string[] | null | undefined): AppRole | null {
  if (!roles || roles.length === 0) return null;
  for (const r of ROLE_PRECEDENCE) if (roles.includes(r)) return r;
  return (roles[0] as AppRole) ?? null;
}

// Shape returned by `select("..., users:users!...(display_name, email, user_roles(role))")` joins.
export interface OperatorLookup {
  display_name?: string | null;
  email?: string | null;
  user_roles?: Array<{ role: string }> | null;
}

export function operatorRoles(op: OperatorLookup | null | undefined): string[] {
  return (op?.user_roles ?? []).map((r) => r.role);
}
