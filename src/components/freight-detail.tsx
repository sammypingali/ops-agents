"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveMaterialAttributes } from "@/app/actions/material-attributes";
import { type MaterialAttributes, EMPTY_ATTRS, hasAnyAttr } from "@/lib/material-attributes";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Per-material freight / within-target detail for the savings report, with an
// inline editor (ops enters MOQ, EXW, freight, tariff, certs — none of which
// live in Tenkara). Shows the material-cost vs CIF/freight split when present.
export function FreightDetail({
  orgId,
  materialId,
  unit,
  attrs,
  canEdit,
}: {
  orgId: string;
  materialId: string;
  unit: string;
  attrs: MaterialAttributes | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<MaterialAttributes>(attrs ?? EMPTY_ATTRS);

  const a = attrs ?? EMPTY_ATTRS;
  const landedOcean =
    a.exw_cost != null ? a.exw_cost + (a.freight_ocean ?? 0) + (a.tariff_duty ?? 0) : null;

  function save() {
    setErr(null);
    start(async () => {
      const r = await saveMaterialAttributes(orgId, materialId, unit, form);
      if (!r.ok) setErr(r.error ?? "save failed");
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (editing) {
    return (
      <div className="border-t bg-muted/10 px-5 py-4 no-print print:hidden">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="MOQ" value={form.moq ?? ""} onChange={(v) => setForm({ ...form, moq: v })} placeholder="1000 kg (4 drums)" />
          <NumField label="Product (EXW) /unit" value={form.exw_cost} onChange={(v) => setForm({ ...form, exw_cost: v })} />
          <Field label="Facility certs" value={form.facility_certs ?? ""} onChange={(v) => setForm({ ...form, facility_certs: v })} placeholder="ISO 22000, Kosher" />
          <NumField label="Ocean freight /unit" value={form.freight_ocean} onChange={(v) => setForm({ ...form, freight_ocean: v })} />
          <Field label="Ocean transit" value={form.freight_ocean_days ?? ""} onChange={(v) => setForm({ ...form, freight_ocean_days: v })} placeholder="30-40 days" />
          <NumField label="Tariff/duty /unit" value={form.tariff_duty} onChange={(v) => setForm({ ...form, tariff_duty: v })} />
          <NumField label="Air freight /unit" value={form.freight_air} onChange={(v) => setForm({ ...form, freight_air: v })} />
          <Field label="Air transit" value={form.freight_air_days ?? ""} onChange={(v) => setForm({ ...form, freight_air_days: v })} placeholder="5-7 days" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setForm(attrs ?? EMPTY_ATTRS); setEditing(false); }} disabled={pending}>Cancel</Button>
          {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t bg-muted/20 px-5 py-3 text-xs">
      {hasAnyAttr(a) ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
          {a.moq && <span><span className="font-medium text-foreground">MOQ:</span> {a.moq}</span>}
          {a.exw_cost != null && <span><span className="font-medium text-foreground">Product (EXW):</span> {money(a.exw_cost)}/{unit}</span>}
          {a.freight_ocean != null && (
            <span><span className="font-medium text-foreground">Ocean freight:</span> {money(a.freight_ocean)}/{unit}{a.freight_ocean_days ? ` (${a.freight_ocean_days})` : ""}</span>
          )}
          {a.freight_air != null && (
            <span><span className="font-medium text-foreground">Air freight:</span> {money(a.freight_air)}/{unit}{a.freight_air_days ? ` (${a.freight_air_days})` : ""}</span>
          )}
          {a.tariff_duty != null && <span><span className="font-medium text-foreground">Tariff/duty:</span> {money(a.tariff_duty)}/{unit}</span>}
          {landedOcean != null && <span><span className="font-medium text-foreground">Est. landed (ocean):</span> {money(landedOcean)}/{unit}</span>}
          {a.facility_certs && <span><span className="font-medium text-foreground">Certs:</span> {a.facility_certs}</span>}
        </div>
      ) : (
        <span className="text-muted-foreground">No freight / MOQ details yet.</span>
      )}
      {canEdit && (
        <button
          className="ml-3 text-primary hover:underline no-print print:hidden"
          onClick={() => { setForm(attrs ?? EMPTY_ATTRS); setEditing(true); }}
        >
          {hasAnyAttr(a) ? "edit" : "add freight"}
        </button>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="number"
        step="any"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </label>
  );
}
