"use server";
import { getSession, hasAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rebuildClientProfile } from "@/lib/client-profile";
import { revalidatePath } from "next/cache";

interface Result { ok: boolean; error?: string }

export interface ClientSettingsInput {
  outreach_mode: "active" | "ghost" | "skip";
  ghost_brand: string | null;
  priority_tier: "standard" | "priority" | "vip";
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  sourcing_notes: string | null;
}

const EDIT_ROLES = ["admin", "ops_lead", "ops_operator"] as const;

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

// Save edits without finalizing. Editing a finalized client drops it back to
// draft so the profile won't rebuild until ops re-finalize the new values.
export async function saveClientSettings(orgId: string, input: ClientSettingsInput): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (!hasAnyRole(session, [...EDIT_ROLES])) return { ok: false, error: "forbidden" };
  if (input.outreach_mode === "ghost" && !clean(input.ghost_brand)) {
    return { ok: false, error: "ghost brand is required for ghost clients" };
  }
  const admin = createAdminClient();

  const { error } = await admin.from("client_settings").upsert(
    {
      org_id: orgId,
      outreach_mode: input.outreach_mode,
      ghost_brand: clean(input.ghost_brand),
      priority_tier: input.priority_tier,
      primary_contact_name: clean(input.primary_contact_name),
      primary_contact_email: clean(input.primary_contact_email),
      sourcing_notes: clean(input.sourcing_notes),
      status: "draft",
      finalized_at: null,
      finalized_by: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" }
  );
  if (error) return { ok: false, error: error.message };

  // Event-driven: rebuild the profile immediately so the tab reflects the edit.
  await rebuildClientProfile(admin, orgId);

  revalidatePath(`/work/orgs`);
  return { ok: true };
}

// Finalize: persist the values and stamp finalized_at, then rebuild the
// profile inline so the Client Profile tab updates immediately.
export async function finalizeClientSettings(orgId: string, input: ClientSettingsInput): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  if (!hasAnyRole(session, [...EDIT_ROLES])) return { ok: false, error: "forbidden" };
  if (input.outreach_mode === "ghost" && !clean(input.ghost_brand)) {
    return { ok: false, error: "ghost brand is required for ghost clients" };
  }
  const admin = createAdminClient();

  const { error } = await admin.from("client_settings").upsert(
    {
      org_id: orgId,
      outreach_mode: input.outreach_mode,
      ghost_brand: clean(input.ghost_brand),
      priority_tier: input.priority_tier,
      primary_contact_name: clean(input.primary_contact_name),
      primary_contact_email: clean(input.primary_contact_email),
      sourcing_notes: clean(input.sourcing_notes),
      status: "finalized",
      finalized_at: new Date().toISOString(),
      finalized_by: session.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" }
  );
  if (error) return { ok: false, error: error.message };

  await rebuildClientProfile(admin, orgId);

  revalidatePath(`/work/orgs`);
  return { ok: true };
}
