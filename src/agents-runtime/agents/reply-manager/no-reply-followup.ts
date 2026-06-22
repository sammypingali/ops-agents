import { stageDraft } from "@/lib/draft-staging";
import type { createAdminClient } from "@/lib/supabase/admin";

// No-reply follow-ups (part of Agent 15). When a supplier never replies to the
// initial RFQ, draft up to two gentle nudges — at 4 and 8 days after the RFQ
// was sent — staged for a human to send. Still no reply after that → Agent 07's
// 14-day case escalation takes over. Nothing auto-sends.

const FOLLOWUP_DAYS = [4, 8]; // days-after-sent for follow-up #1 and #2
const DAY = 24 * 3600 * 1000;
const MAX_PER_RUN = 50;
const TERMINAL = new Set(["stale", "closed_declined", "finalized", "price_captured"]);

type Ctx = { agentId: string | null; runId: string | null; log: (m: string, o?: any) => Promise<void> };
type Admin = ReturnType<typeof createAdminClient>;

function buildFollowupBody(opts: { contactName: string | null; material: string | null; signoff: string; n: number }): string {
  const greeting = opts.contactName ? `Hi ${opts.contactName.split(/\s+/)[0]},` : "Hi there,";
  const mat = opts.material ? ` for ${opts.material}` : "";
  const opener =
    opts.n === 1
      ? `Just following up on my note below — would you be able to share pricing${mat}?`
      : `Circling back one more time on pricing${mat} — I'd still love to get a quote from you.`;
  return [
    greeting,
    "",
    `${opener} A quote with price, pack size, lead time, and MOQ would be perfect, and I'm happy to answer any questions.`,
    "",
    "Thanks,",
    opts.signoff,
  ].join("\n");
}

export async function runNoReplyFollowups(ctx: Ctx, admin: Admin): Promise<{ drafted: number; skipped: number }> {
  let drafted = 0;
  let skipped = 0;

  // Only follow up on Agent 04's initial cold outreach — not re-quotes (Agent 02)
  // or reply responses (Agent 15 itself).
  const { data: a4 } = await admin.from("agents").select("id").eq("slug", "agent-04-outreach").maybeSingle();
  if (!a4?.id) {
    await ctx.log("follow-up: agent-04-outreach not found, skipping", { step: "followup" });
    return { drafted, skipped };
  }

  const { data: sent } = await admin
    .from("draft_references")
    .select("id, org_id, supplier_id, material_id, subject, assigned_operator, metadata, email_client, thread_id, reviewed_at")
    .eq("agent_id", a4.id)
    .eq("status", "sent") // the RFQ was actually sent
    .is("metadata->reply_detected", null) // and got no reply
    .not("reviewed_at", "is", null) // reviewed_at = the sent timestamp (set by the webhook)
    .limit(300);

  const now = Date.now();
  for (const r of (sent ?? []) as any[]) {
    if (drafted >= MAX_PER_RUN) break;
    const meta = (r.metadata ?? {}) as any;
    const fu = Number(meta.followup_count ?? 0);
    if (fu >= FOLLOWUP_DAYS.length) continue; // both follow-ups already drafted
    if (TERMINAL.has(meta.flow_status)) continue;

    const sentAt = r.reviewed_at ? new Date(r.reviewed_at).getTime() : null;
    if (!sentAt) continue;
    if ((now - sentAt) / DAY < FOLLOWUP_DAYS[fu]) continue; // not due yet

    const to = meta.supplier_contact_email as string | undefined;
    if (!to) {
      skipped++;
      continue;
    }
    const signoff = meta.suggested_signoff ?? meta.ghost_brand ?? "Sourcing Team";
    const body = buildFollowupBody({
      contactName: meta.supplier_name ?? null,
      material: meta.material_name ?? null,
      signoff,
      n: fu + 1,
    });

    const staged = await stageDraft({
      admin,
      agentId: ctx.agentId,
      runId: ctx.runId,
      orgId: r.org_id,
      supplierId: r.supplier_id,
      materialId: r.material_id,
      to: { name: meta.supplier_name ?? null, address: to },
      subject: (r.subject ?? "").startsWith("Re:") ? r.subject : `Re: ${r.subject ?? "your quote"}`,
      body,
      assignedOperator: r.assigned_operator ?? null,
      emailClient: (r.email_client as "missive" | "rod_app") ?? "missive",
      conversationId: r.thread_id ?? null, // reply into the original thread
      metadata: {
        outreach_mode: meta.outreach_mode ?? "ghost",
        ghost_brand: meta.ghost_brand ?? null,
        supplier_contact_email: to,
        supplier_name: meta.supplier_name ?? null,
        draft_kind: "no_reply_followup",
        followup_n: fu + 1,
        staged_via: "agent-15-followup",
      },
    });

    if (staged.ok) {
      drafted++;
      await admin
        .from("draft_references")
        .update({ metadata: { ...meta, followup_count: fu + 1, last_followup_at: new Date().toISOString() } })
        .eq("id", r.id);
      await ctx.log(`No-reply follow-up #${fu + 1} drafted for ${meta.supplier_name ?? to}`, { step: "followup" });
    } else {
      skipped++;
      await ctx.log(`Follow-up stage failed for ${to}: ${staged.error}`, { level: "warn", step: "followup" });
    }
  }

  return { drafted, skipped };
}
