"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveClientSettings, finalizeClientSettings, type ClientSettingsInput } from "@/app/actions/client-settings";

export interface ClientSettingsValue extends ClientSettingsInput {
  status: "draft" | "finalized";
}

const MODE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "ghost", label: "Ghost" },
  { value: "skip", label: "Skip" },
];
const TIER_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "priority", label: "Priority" },
  { value: "vip", label: "VIP" },
];

export function ClientProfileForm({
  orgId,
  initial,
  canEdit,
}: {
  orgId: string;
  initial: ClientSettingsValue | null;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<ClientSettingsInput["outreach_mode"]>(initial?.outreach_mode ?? "active");
  const [ghostBrand, setGhostBrand] = useState(initial?.ghost_brand ?? "");
  const [tier, setTier] = useState<ClientSettingsInput["priority_tier"]>(initial?.priority_tier ?? "standard");
  const [contactName, setContactName] = useState(initial?.primary_contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.primary_contact_email ?? "");
  const [notes, setNotes] = useState(initial?.sourcing_notes ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  function collect(): ClientSettingsInput {
    return {
      outreach_mode: mode,
      ghost_brand: mode === "ghost" ? ghostBrand : null,
      priority_tier: tier,
      primary_contact_name: contactName,
      primary_contact_email: contactEmail,
      sourcing_notes: notes,
    };
  }

  function run(action: (orgId: string, input: ClientSettingsInput) => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null);
    start(async () => {
      const res = await action(orgId, collect());
      if (res.ok) {
        setMsg({ kind: "ok", text: okText });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "Something went wrong" });
      }
    });
  }

  const disabled = !canEdit || pending;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Outreach mode">
          <Select value={mode} onValueChange={(v) => setMode(v as any)} options={MODE_OPTIONS} disabled={disabled} ariaLabel="Outreach mode" />
        </Field>
        <Field label="Priority tier">
          <Select value={tier} onValueChange={(v) => setTier(v as any)} options={TIER_OPTIONS} disabled={disabled} ariaLabel="Priority tier" />
        </Field>
        {mode === "ghost" && (
          <Field label="Ghost brand">
            <Input value={ghostBrand} onChange={(e) => setGhostBrand(e.target.value)} disabled={disabled} placeholder="Brand we source under" />
          </Field>
        )}
        <Field label="Primary contact name">
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} disabled={disabled} placeholder="—" />
        </Field>
        <Field label="Primary contact email">
          <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} disabled={disabled} placeholder="—" type="email" />
        </Field>
      </div>

      <Field label="Sourcing notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={disabled}
          rows={3}
          placeholder="Anything ops should know about this client…"
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </Field>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button onClick={() => run(saveClientSettings, "Saved — profile updated.")} disabled={pending} variant="secondary">
            Save draft
          </Button>
          <Button onClick={() => run(finalizeClientSettings, "Finalized — profile updated.")} disabled={pending}>
            Finalize
          </Button>
          {msg && (
            <span className={msg.kind === "ok" ? "text-sm text-emerald-700" : "text-sm text-red-700"}>{msg.text}</span>
          )}
        </div>
      )}
      {!canEdit && <p className="text-xs text-muted-foreground">You don&apos;t have permission to edit client settings.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      {children}
    </label>
  );
}
