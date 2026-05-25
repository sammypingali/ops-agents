import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const sections = [
  { href: "", label: "Overview" },
  { href: "/revalidation", label: "Revalidation" },
  { href: "/outreach", label: "Outreach" },
  { href: "/cases", label: "Cases" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/approvals", label: "Approvals" },
  { href: "/quotes", label: "Quotes" },
];

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const admin = createAdminClient();
  const { data: org } = await admin.from("orgs").select("id, slug, name, is_internal").eq("slug", params.slug).maybeSingle();
  if (!org) notFound();

  const path = headers().get("x-tackle-path") ?? "";
  const base = `/work/orgs/${org.slug}`;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between border-b border-border pb-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">{org.name}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Org workspace
            {org.is_internal && <span className="ml-2 text-[9px] uppercase tracking-wider bg-secondary px-1.5 py-0.5 rounded">Internal</span>}
          </p>
        </div>
      </header>
      <nav className="flex gap-1 text-sm">
        {sections.map((s) => {
          const href = `${base}${s.href}`;
          const active = s.href === "" ? path === base : path === href || path.startsWith(href + "/");
          return (
            <Link
              key={s.href}
              href={href}
              className={cn(
                "px-3 py-1.5 rounded-md transition-colors",
                active ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
