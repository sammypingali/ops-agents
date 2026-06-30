"use server";
import { revalidatePath } from "next/cache";
import { getSession, hasAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { seesAllOrgs, getAssignedOrgIds } from "@/lib/org-access";
import { getOrgOperatorPool } from "@/lib/operator-assignment";

interface Result {
  ok: boolean;
  error?: string;
}

// Assign (or clear) the operator who owns a supplier for a client. ops_operator
// can only assign/unassign THEMSELVES; ops_lead/admin can assign anyone in the
// org's operator pool. Reassigning also moves the supplier's pending (un-sent)
// drafts to the new operator so the change takes effect immediately.
export async function assignSupplierOperator(orgId: string, supplierId: string, operatorId: string | null): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (!hasAnyRole(session, ["admin", "ops_lead", "ops_operator"])) return { ok: false, error: "forbidden" };
  if (!orgId || !supplierId) return { ok: false, error: "missing org or supplier" };

  // Org access.
  if (!seesAllOrgs(session)) {
    const assigned = await getAssignedOrgIds(session);
    if (assigned !== null && !assigned.includes(orgId)) return { ok: false, error: "forbidden" };
  }

  const admin = createAdminClient();
  const isLead = hasAnyRole(session, ["admin", "ops_lead"]);

  // Clear assignment.
  if (operatorId === null) {
    if (!isLead) {
      // Operators may only clear their own claim.
      const { data: cur } = await admin
        .from("supplier_assignment")
        .select("operator_id")
        .eq("org_id", orgId)
        .eq("supplier_id", supplierId)
        .maybeSingle();
      if (cur && cur.operator_id !== session.userId) return { ok: false, error: "can only unassign yourself" };
    }
    const { error } = await admin.from("supplier_assignment").delete().eq("org_id", orgId).eq("supplier_id", supplierId);
    if (error) return { ok: false, error: error.message };
  } else {
    // Operators may only assign themselves.
    if (!isLead && operatorId !== session.userId) return { ok: false, error: "you can only assign yourself" };
    // The target must be an actual operator in this org's pool (or yourself).
    if (operatorId !== session.userId) {
      const pool = await getOrgOperatorPool(admin, orgId).catch(() => []);
      if (!pool.some((p) => p.id === operatorId)) return { ok: false, error: "not an operator for this client" };
    }
    const { error } = await admin.from("supplier_assignment").upsert(
      {
        supplier_id: supplierId,
        org_id: orgId,
        operator_id: operatorId,
        assigned_by: session.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "supplier_id,org_id" }
    );
    if (error) return { ok: false, error: error.message };

    // Move the supplier's pending (un-sent) drafts to the new operator so the
    // assignment takes effect on work already in flight.
    await admin
      .from("draft_references")
      .update({ assigned_operator: operatorId })
      .eq("org_id", orgId)
      .eq("supplier_id", supplierId)
      .in("status", ["staged", "reviewed"]);
  }

  await admin.from("audit_log").insert({
    actor_user_id: session.userId,
    action: operatorId === null ? "supplier.unassigned" : "supplier.assigned",
    target_table: "supplier_assignment",
    target_id: orgId,
    diff: { supplier_id: supplierId, operator_id: operatorId },
  });

  revalidatePath("/work/orgs/[slug]/suppliers", "page");
  return { ok: true };
}
