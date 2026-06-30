"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { assignSupplierOperator } from "@/app/actions/supplier-assignment";

// Per-supplier operator picker. Choosing an operator writes a manual assignment
// (agents route that client's outreach to them); choosing "Auto" clears it and
// falls back to the sticky-random default (shown in the Auto label).
export function SupplierOperatorAssign({
  orgId,
  supplierId,
  assignedId,
  autoName,
  options,
}: {
  orgId: string;
  supplierId: string;
  assignedId: string | null;
  autoName: string | null;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const opts = [
    { value: "", label: autoName ? `Auto · ${autoName}` : "Auto (unassigned)" },
    ...options.map((o) => ({ value: o.id, label: o.name })),
  ];

  function onChange(val: string) {
    setErr(null);
    start(async () => {
      const r = await assignSupplierOperator(orgId, supplierId, val || null);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "failed");
    });
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Select
        size="sm"
        className="min-w-[11rem]"
        ariaLabel="Assign operator"
        value={assignedId ?? ""}
        onValueChange={onChange}
        options={opts}
        disabled={pending}
      />
      {err && <span className="text-[11px] text-red-600 dark:text-red-400">{err}</span>}
    </div>
  );
}
