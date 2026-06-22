"use client";

import { Table, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { LeadRichRow, LeadRichHeaders, leadRichColSpan } from "@/components/lead-rich-row";
import { useListFilter, byString, byNumberDesc, byDateDesc } from "@/components/use-list-filter";
import { ListCsvButton } from "@/components/list-csv-button";
import { filenameFor } from "@/lib/csv";

export function LeadsList({ rows, canAct, slug }: { rows: any[]; canAct: boolean; slug: string }) {
  const { filtered, controls } = useListFilter(rows, {
    searchText: (r) => `${r.supplier_name ?? ""} ${r.material_name ?? ""} ${r.grade ?? ""}`,
    searchPlaceholder: "supplier, material, grade…",
    sorts: [
      { value: "confidence", label: "Confidence", compare: byNumberDesc((r: any) => r.confidence_score) },
      { value: "supplier", label: "Supplier (A–Z)", compare: byString((r: any) => r.supplier_name) },
      { value: "material", label: "Material (A–Z)", compare: byString((r: any) => r.material_name) },
      { value: "newest", label: "Newest", compare: byDateDesc((r: any) => r.created_at) },
    ],
  });

  const csvRows = filtered.map((r: any) => [
    r.supplier_name ?? "",
    r.material_name ?? "",
    r.grade ?? "",
    r.confidence_score ?? "",
    r.source ?? "",
    r.status ?? "",
    r.created_at ?? "",
  ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {controls}
        <ListCsvButton
          filename={filenameFor(slug, "leads")}
          headers={["Supplier", "Material", "Grade", "Confidence", "Source", "Status", "Created"]}
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
