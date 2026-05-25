import type { AppRole } from "@/lib/auth";

// User-facing display labels (DB enum stays as-is for back-compat).
export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  ops_lead: "Lead Operator",
  ops_operator: "Operator",
  account_manager: "Account Manager",
  monitor: "Monitor",
};

// Chip color treatment per role (Tackle Box palette).
// - Admin / Lead Operator: primary blue (high signal)
// - Monitor: cyan accent (neutral signal)
// - Operator: muted gray (most common, no need to draw attention)
// - Account Manager: warm highlight (distinct from supplier-facing roles)
export const ROLE_CHIP: Record<AppRole, string> = {
  admin: "bg-primary text-primary-foreground",
  ops_lead: "bg-primary text-primary-foreground",
  ops_operator: "bg-secondary text-secondary-foreground",
  account_manager: "bg-highlight text-foreground",
  monitor: "bg-accent text-accent-foreground",
};

export function roleLabel(role: AppRole | string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role as AppRole] ?? role;
}

export function rolesGlossary(): { role: AppRole; label: string; blurb: string }[] {
  return [
    { role: "admin", label: "Admin", blurb: "Full access to everything. Can configure agents, invite anyone, manage org assignments." },
    { role: "ops_lead", label: "Lead Operator", blurb: "Day-to-day ops manager. Approves suppliers/quotes, triages escalations, invites Operators." },
    { role: "ops_operator", label: "Operator", blurb: "Reviews agent-staged drafts, classifies inbound cases, executes supplier outreach." },
    { role: "account_manager", label: "Account Manager", blurb: "Client-facing only. Bridges client and ops; does not touch suppliers." },
    { role: "monitor", label: "Monitor", blurb: "Watches agent activity and performance. Read-only on ops queues, write on agent stamps." },
  ];
}
