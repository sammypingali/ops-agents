"use client";
import { useState, useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";
import { markApprovalsUploaded, approveOrReject } from "@/app/actions/approvals";
import { useRouter } from "next/navigation";

export interface ApprovalRow {
  id: string;
  type: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  notes: string | null;
  payload: Record<string, any> | null;
  agents: { name: string | null; slug: string | null } | null;
}

const TYPE_LABELS: Record<string, string> = {
  supplier: "New supplier",
  quote: "New quote",
  escalation_outcome: "Escalation outcome",
  doc_refresh: "Doc refresh",
};

export function ApprovalsTable({ orgSlug, rows }: { orgSlug: string; rows: ApprovalRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedDownloadable = useMemo(
    () => rows.filter((r) => selected.has(r.id) && r.status === "approved"),
    [rows, selected]
  );
  const selectedUploadable = useMemo(
    () => rows.filter((r) => selected.has(r.id) && r.status === "ready_for_export"),
    [rows, selected]
  );

  // For bulk download we require homogeneous (org, type) since CSV columns are derived from payload shape.
  // Single-row downloads are always safe.
  const bulkDownloadValid = selectedDownloadable.length > 0 &&
    new Set(selectedDownloadable.map((r) => r.type)).size === 1;

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  function downloadSelected() {
    const ids = selectedDownloadable.map((r) => r.id).join(",");
    window.location.assign(`/api/exports/approvals?ids=${encodeURIComponent(ids)}`);
    // Status update happens server-side. Refresh after a moment so the row UI catches up.
    setTimeout(() => router.refresh(), 800);
  }

  function downloadRow(id: string) {
    window.location.assign(`/api/exports/approvals?ids=${encodeURIComponent(id)}`);
    setTimeout(() => router.refresh(), 800);
  }

  function markUploaded() {
    setMsg(null);
    const ids = selectedUploadable.map((r) => r.id);
    start(async () => {
      const res = await markApprovalsUploaded(ids);
      if (!res.ok) setMsg(res.error ?? "failed");
      else { setSelected(new Set()); router.refresh(); }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={selectedDownloadable.length === 0 || !bulkDownloadValid}
          onClick={downloadSelected}
          title={!bulkDownloadValid && selectedDownloadable.length > 1 ? "Selected rows must share the same approval type to bulk-export" : undefined}
        >
          Download {selectedDownloadable.length > 1 ? `${selectedDownloadable.length} as bulk CSV` : "CSV"}
        </Button>
        <Button variant="outline" size="sm" disabled={selectedUploadable.length === 0 || pending} onClick={markUploaded}>
          Mark {selectedUploadable.length || ""} as uploaded to Tenkara
        </Button>
        {msg && <span className="text-xs text-destructive">{msg}</span>}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
            </TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const subject = r.payload?.subject ?? r.payload?.name ?? r.payload?.supplier_name ?? r.payload?.material_name ?? "—";
            return (
              <TableRow key={r.id}>
                <TableCell><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></TableCell>
                <TableCell>{TYPE_LABELS[r.type] ?? r.type}</TableCell>
                <TableCell className="font-medium truncate max-w-[28ch]">{String(subject)}</TableCell>
                <TableCell><StatusBadge s={r.status} /></TableCell>
                <TableCell className="text-muted-foreground">{r.agents?.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{relativeTime(r.requested_at)}</TableCell>
                <TableCell className="text-right">
                  {r.status === "approved" && (
                    <button onClick={() => downloadRow(r.id)} className="text-primary hover:underline text-sm">Download CSV →</button>
                  )}
                  {r.status === "pending" && <PendingRowActions id={r.id} />}
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No approvals queued for this org.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function PendingRowActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="inline-flex gap-2">
      <button
        disabled={pending}
        onClick={() => start(async () => { const r = await approveOrReject(id, "approved"); if (r.ok) router.refresh(); })}
        className="text-primary hover:underline text-sm"
      >
        Approve
      </button>
      <button
        disabled={pending}
        onClick={() => start(async () => { const r = await approveOrReject(id, "rejected"); if (r.ok) router.refresh(); })}
        className="text-muted-foreground hover:underline text-sm"
      >
        Reject
      </button>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  if (s === "pending") return <Badge variant="warn">Pending</Badge>;
  if (s === "approved") return <Badge variant="success">Approved — ready to export</Badge>;
  if (s === "ready_for_export") return <Badge variant="default">Downloaded — awaiting Tenkara upload</Badge>;
  if (s === "exported") return <Badge variant="secondary">Uploaded</Badge>;
  if (s === "rejected") return <Badge variant="danger">Rejected</Badge>;
  if (s === "needs_edit") return <Badge variant="warn">Needs edit</Badge>;
  return <Badge variant="secondary">{s}</Badge>;
}
