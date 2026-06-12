import Link from "next/link";
import { roleLabel, ROLE_CHIP } from "@/lib/roles";
import type { SessionContext } from "@/lib/auth";
import { hasAnyRole } from "@/lib/auth";
import { seesAllOrgs } from "@/lib/org-access";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLink } from "@/components/nav-link";
import { cn } from "@/lib/utils";

export interface OrgItem {
  slug: string;
  name: string;
  isInternal?: boolean;
}

// Sidebar shows a capped quick-list; the full set lives on the searchable
// /clients page so the nav stays usable at hundreds of clients.
const CLIENT_CAP = 8;

export function Shell({
  session,
  orgs,
  children,
}: {
  session: SessionContext;
  orgs: OrgItem[];
  children: React.ReactNode;
}) {
  const allOrgs = seesAllOrgs(session);

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-border bg-background flex flex-col">
        <div className="px-5 pt-6 pb-4">
          <Link href="/" className="flex items-center gap-2.5">
            <TenkaraMark className="h-8 w-8 shrink-0" />
            <div>
              <div className="font-serif text-2xl tracking-tight leading-none">Control Room</div>
              <div className="text-xs text-muted-foreground mt-1">Tenkara sourcing</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 text-sm space-y-0.5 overflow-y-auto">
          <NavLink href="/inbox" match="prefix">Inbox</NavLink>

          <Link href="/clients" className="group flex items-center justify-between px-3 pt-4 pb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold group-hover:text-foreground">Clients</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {allOrgs ? "All" : `${orgs.length} assigned`}
            </span>
          </Link>
          {orgs.length === 0 && <div className="text-xs text-muted-foreground px-3">No clients assigned yet</div>}
          {orgs.slice(0, CLIENT_CAP).map((o) => (
            <NavLink key={o.slug} href={`/clients/${o.slug}`} match="prefix">
              <span className={o.isInternal ? "text-muted-foreground" : ""}>
                {o.name}
                {o.isInternal && <span className="ml-2 text-[9px] uppercase tracking-wider bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">Internal</span>}
              </span>
            </NavLink>
          ))}
          {orgs.length > CLIENT_CAP && (
            <Link href="/clients" className="block px-3 py-1.5 ml-3.5 text-xs text-primary hover:underline">
              View all {orgs.length} clients →
            </Link>
          )}

          <div className="pt-4">
            <NavLink href="/settings" match="prefix">Settings</NavLink>
          </div>
        </nav>

        <div className="mt-auto border-t border-border px-5 py-4 space-y-2">
          <Link href="/settings/profile" className="block text-sm hover:underline">
            <div className="font-medium">{session.displayName ?? session.email}</div>
            <div className="text-xs text-muted-foreground truncate">{session.email}</div>
          </Link>
          <div className="flex flex-wrap gap-1">
            {session.roles.map((r) => (
              <span key={r} className={cn("inline-flex items-center justify-center text-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide leading-tight", ROLE_CHIP[r])}>
                {roleLabel(r)}
              </span>
            ))}
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 min-h-screen">
        <div className="px-10 py-8 max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

// Tenkara interlocking-loop mark (figure-eight knot) in brand blue + cream.
// Faithful recreation of the media-kit mark; swap the official SVG 1:1 if exported.
function TenkaraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0011FF" />
      <path
        d="M32 32 C 27 22.5, 13 22.5, 13 32 C 13 41.5, 27 41.5, 32 32 C 37 22.5, 51 22.5, 51 32 C 51 41.5, 37 41.5, 32 32 Z"
        stroke="#F7F6F5"
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Kept for use by client-workspace and settings sub-navs.
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 pt-4 pb-1.5 font-semibold">{children}</div>;
}

// Retained so role-gated UI elsewhere can branch on it without re-importing auth.
export function isAdminOrLead(session: SessionContext): boolean {
  return hasAnyRole(session, ["admin", "ops_lead"]);
}
