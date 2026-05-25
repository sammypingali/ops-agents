"use server";
import { getSession, hasAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

interface Result { ok: boolean; error?: string }

export async function markApprovalsUploaded(ids: string[]): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (!hasAnyRole(session, ["admin", "ops_lead", "ops_operator"])) {
    return { ok: false, error: "forbidden" };
  }
  if (!ids || ids.length === 0) return { ok: false, error: "no ids" };
  const admin = createAdminClient();

  // Only transition from ready_for_export -> exported. Don't allow re-flipping decided rows or skipping the download step.
  const { data: eligible } = await admin
    .from("pending_approvals")
    .select("id")
    .in("id", ids)
    .eq("status", "ready_for_export");
  const eligibleIds = (eligible ?? []).map((r) => r.id);
  if (eligibleIds.length === 0) return { ok: false, error: "no eligible rows (download CSV first)" };

  const { error } = await admin
    .from("pending_approvals")
    .update({ status: "exported" })
    .in("id", eligibleIds);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_log").insert(
    eligibleIds.map((id) => ({
      actor_user_id: session.userId,
      action: "approval.exported_confirmed",
      target_table: "pending_approvals",
      target_id: id,
    }))
  );

  return { ok: true };
}

export async function approveOrReject(id: string, decision: "approved" | "rejected", notes?: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (!hasAnyRole(session, ["admin", "ops_lead"])) return { ok: false, error: "forbidden" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("pending_approvals")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: session.userId,
      notes: notes ?? null,
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_log").insert({
    actor_user_id: session.userId,
    action: `approval.${decision}`,
    target_table: "pending_approvals",
    target_id: id,
  });
  return { ok: true };
}
