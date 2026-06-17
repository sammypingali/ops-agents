import { redirect } from "next/navigation";
import { getSession, hasAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAssignedOrgIds } from "@/lib/org-access";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getPricePulse } from "@/lib/price-pulse";

export const dynamic = "force-dynamic";

function money(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default async function PricePulsePage({
  searchParams,
}: {
  searchParams: { q?: string; min?: string; client?: string };
}) {
  const session = (await getSession())!;
  if (!hasAnyRole(session, ["admin", "ops_lead", "ops_operator", "monitor"])) redirect("/work");

  const minQuotes = Math.max(2, Number(searchParams.min ?? "3") || 3);
  const search = (searchParams.q ?? "").trim().toLowerCase();
  const clientSlug = (searchParams.client ?? "").trim();

  // Client filter options — only orgs linked to a Tenkara org (others have no
  // quotes), scoped to the operator's assignments.
  const admin = createAdminClient();
  const assigned = await getAssignedOrgIds(session);
  let orgQuery = admin
    .from("orgs")
    .select("slug, name, tenkara_org_id")
    .not("tenkara_org_id", "is", null)
    .order("name");
  if (assigned) orgQuery = orgQuery.in("id", assigned);
  const { data: orgs } = await orgQuery;
  const clientOptions = (orgs ?? []) as { slug: string; name: string; tenkara_org_id: string }[];
  const selectedClient = clientSlug ? clientOptions.find((o) => o.slug === clientSlug) ?? null : null;

  let pulse = await getPricePulse({
    minQuotes,
    limit: 500,
    tenkaraOrgId: selectedClient?.tenkara_org_id ?? null,
  });
  if (search) pulse = pulse.filter((p) => p.material_name.toLowerCase().includes(search));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Price Pulse</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Live market spread per material across all suppliers in the Tenkara corpus — min / average / max per-unit
          price. Grouped by owning client, then material and unit (different units for the same material are not
          directly comparable). Quotes fill from the marketplace and from scanned supplier replies; where a quote has a
          marketplace listing, the cheapest supplier links out to it. Sample quotes and unit-mislabeled outliers are
          excluded; materials with at least {minQuotes} quotes are shown. Read-only.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 text-sm" action="/work/price-pulse" method="get">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Client</span>
          <select
            name="client"
            defaultValue={clientSlug}
            className="rounded border border-border bg-background px-2 py-1 text-sm w-52"
          >
            <option value="">All clients</option>
            {clientOptions.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Material</span>
          <input
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="Filter materials…"
            className="rounded border border-border bg-background px-2 py-1 text-sm w-56"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground" title="Hide materials with fewer than this many quotes — filters out thin, noisy data.">
            Min quotes
          </span>
          <input
            name="min"
            defaultValue={String(minQuotes)}
            inputMode="numeric"
            className="rounded border border-border bg-background px-2 py-1 text-sm w-20"
          />
        </label>
        <button type="submit" className="rounded border border-border px-3 py-1 hover:bg-secondary h-[34px]">Apply</button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Material</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Min</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">Max</TableHead>
            <TableHead className="text-right">Quotes</TableHead>
            <TableHead className="text-right">Suppliers</TableHead>
            <TableHead>Cheapest supplier</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pulse.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                No materials meet the threshold.
              </TableCell>
            </TableRow>
          )}
          {pulse.map((p) => (
            <TableRow key={`${p.material_id}-${p.unit}`}>
              <TableCell className="text-sm text-muted-foreground">{p.org_name ?? "—"}</TableCell>
              <TableCell className="font-medium">{p.material_name}</TableCell>
              <TableCell className="text-muted-foreground">{p.unit}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.min_unit_price)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.avg_unit_price)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.max_unit_price)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{p.n_quotes}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{p.n_suppliers}</TableCell>
              <TableCell className="text-sm">
                {p.cheapest_supplier_name ? (
                  p.cheapest_product_url ? (
                    <a
                      href={p.cheapest_product_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {p.cheapest_supplier_name} ↗
                    </a>
                  ) : (
                    p.cheapest_supplier_name
                  )
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
