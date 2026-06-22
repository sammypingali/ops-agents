"use client";

import { useState } from "react";
import { Table, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { LeadRichRow, LeadRichHeaders, leadRichColSpan, leadMarketKind } from "@/components/lead-rich-row";
import { useListFilter, byString, byDateDesc } from "@/components/use-list-filter";
import { ListCsvButton } from "@/components/list-csv-button";
import { Select } from "@/components/ui/select";
import { filenameFor } from "@/lib/csv";

const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "marketplace", label: "Marketplace" },
  { value: "direct", label: "Direct" },
];

export function LeadsList({ rows, canAct, slug }: { rows: any[]; canAct: boolean; slug: string }) {
  const [type, setType] = useState("all");
  const typeRows =
    type === "all"
      ? rows
      : rows.filter((r: any) => (r.market_kind ?? leadMarketKind(r.payload?.site_type)) === type);

  const { filtered, controls } = useListFilter(typeRows, {
    searchText: (r) => `${r.supplier_name ?? ""} ${r.material_name ?? ""} ${r.grade ?? ""}`,
    searchPlaceholder: "supplier, material, grade…",
    sorts: [
      { value: "newest", label: "Newest", compare: byDateDesc((r: any) => r.created_at) },
      { value: "supplier", label: "Supplier (A–Z)", compare: byString((r: any) => r.supplier_name) },
      { value: "material", label: "Material (A–Z)", compare: byString((r: any) => r.material_name) },
    ],
    defaultSort: "newest",
  });

  const csvRows = filtered.map((r: any) => [
    r.supplier_name ?? "",
    r.material_name ?? "",
    r.grade ?? "",
    r.market_kind ?? leadMarketKind(r.payload?.site_type) ?? "",
    r.source ?? "",
    r.status ?? "",
    r.created_at ?? "",
  ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {controls}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Type</span>
            <Select size="sm" className="min-w-[9rem]" ariaLabel="Type" value={type} onValueChange={setType} options={TYPE_OPTIONS} />
          </label>
        </div>
        <ListCsvButton
          filename={filenameFor(slug, "leads")}
          headers={["Supplier", "Material", "Grade", "Type", "Source", "Status", "Created"]}
          rows={csvRows}
        />
      </div>
      <Table>
        <TableHeader>
          <LeadRichHeaders showOrg={false} />
        </TableHeader>
        <TableBody>
          {filtered.map((r: any) => (
            <LeadRichRow key={r.id} r={r} canAct={canAct} showOrg={false} />
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={leadRichColSpan(false)} className="text-center py-8 text-muted-foreground">
                No leads match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
