// Missive API client — staging drafts only. Never sends.
//
// Safety invariants enforced at compile time:
//   - `send: true` is rejected by TypeScript (the type below excludes it)
//   - `from_field` is rejected by TypeScript (excluded from CreateDraftInput)
//   - At runtime we also assert these aren't snuck in via `Object.assign` etc.
//
// Reference: https://learn.missiveapp.com/api-documentation/drafts

const MISSIVE_BASE = "https://public.missiveapp.com/v1";

export interface MissiveRecipient {
  name?: string;
  address: string;
}

// `from_field` and `send` are deliberately not part of this type. We want
// operators to set the From in Missive UI before clicking Send. The runtime
// guard below also throws if either field appears.
export interface CreateDraftInput {
  body: string;                       // can be HTML or plain
  subject?: string;
  to_fields?: MissiveRecipient[];     // array of {name?, address}
  cc_fields?: MissiveRecipient[];
  bcc_fields?: MissiveRecipient[];
  organization?: string;              // Missive organization id
  team?: string;                      // teamspace id (e.g. Auto Outbox Testing)
  conversation?: string;              // existing conversation id to attach to
  references?: string[];              // email Message-IDs for threading
  external_response?: { id: string }; // optional reference
  // Tags/labels — Missive allows passing label IDs here:
  add_users?: string[];
  add_assignees?: string[];
  add_to_inbox?: boolean;
  add_to_team_inbox?: boolean;
  // Plus arbitrary attachments aren't supported in this minimal client.
}

export interface MissiveDraft {
  id: string;                         // draft id
  conversation_id?: string;
  subject?: string;
  body?: string;
  created_at?: string;
}

const SAFETY_BANNED_KEYS = new Set(["send", "from_field"]);

function assertNoSendOrFromField(input: Record<string, unknown>) {
  for (const k of Object.keys(input)) {
    if (SAFETY_BANNED_KEYS.has(k)) {
      throw new Error(
        `[missive client safety] Refusing to POST a draft that includes "${k}". ` +
        `from_field must remain empty (operator picks the sender) and send must never be true (operator clicks Send).`
      );
    }
  }
}

export async function createMissiveDraft(input: CreateDraftInput): Promise<MissiveDraft> {
  const token = process.env.MISSIVE_API_TOKEN;
  if (!token) throw new Error("MISSIVE_API_TOKEN not configured");

  const payload: Record<string, unknown> = { ...input };
  // Be paranoid: scrub banned fields even if they snuck in via a malformed cast.
  for (const k of SAFETY_BANNED_KEYS) delete payload[k];
  assertNoSendOrFromField(payload);

  const res = await fetch(`${MISSIVE_BASE}/drafts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ drafts: payload }),  // Missive wraps the payload
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Missive POST /drafts failed: ${res.status} ${text.slice(0, 500)}`);
  }
  const body = await res.json();
  // The response shape Missive returns is { drafts: { id, conversation, ... } }
  const drafts = body.drafts ?? body;
  return {
    id: drafts.id ?? drafts.draft?.id ?? "",
    conversation_id: drafts.conversation ?? drafts.conversation_id,
    subject: drafts.subject,
    body: drafts.body,
    created_at: drafts.created_at,
  };
}

// Build a Missive UI URL for a given thread+draft so operators can deep-link in.
export function missiveDraftLink(conversationId: string, draftId: string): string {
  return `https://mail.missiveapp.com/#inbox/conversations/${conversationId}/drafts/${draftId}`;
}
