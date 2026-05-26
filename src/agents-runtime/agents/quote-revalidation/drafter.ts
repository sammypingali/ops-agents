import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_BASE = `You are writing a supplier outreach email asking them to re-validate a quote (or set of quotes) the company has on file that are past their reanalyze date.

Write the email like a human sourcing coordinator wrote it from scratch — warm, casual, professional, not templated. Every email should read uniquely.

STYLE GUIDE:
- First-name basis. Vary greetings naturally ("Hi", "Hey", "Hello").
- Short paragraphs separated by blank lines.
- Under 130 words total in the body.
- Hopeful, non-accusatory framing. We're checking in to keep records current, not complaining.

WHEN PREV PRICING / LEAD TIME IS PROVIDED:
- Mention it inline (single material) or include in the bulleted list (multi-material), and ask whether it's still the same.

FORMATTING:
- Multiple materials (2+): organized bullet list, one per line, with prev pricing/lead time + last-quote date.
- Single material: brief paragraph, mention the prev pricing inline. No bullet list.

DO NOT USE:
- Em dashes (—).
- Offers to "jump on a call", "hop on a quick call", "schedule a meeting", or any synonym.
- AI tells: "I hope this email finds you well", "Per our records", "I am reaching out to", "In conclusion", "Please don't hesitate", "circle back", "touch base".
- Accusatory language.
- Fabricated prior conversations or relationships not present in the data.

OUTPUT: respond with a JSON object exactly matching this schema:
{
  "subject": "<short, friendly subject line, no em dashes>",
  "body": "<full email body — greeting, 2-3 short paragraphs (or 1 paragraph + bulleted list for multi-material), ask, sign-off>"
}`;

export interface DraftPayload {
  subject: string;
  body: string;
}

export interface DraftUsage {
  inputTokens: number;
  outputTokens: number;
}

function systemPromptFor(mode: "active" | "ghost", clientName: string, ghostBrand?: string): string {
  if (mode === "active") {
    return SYSTEM_BASE + `

SIGN-OFF FOR THIS EMAIL:
- The email is FROM the client (${clientName}'s purchasing team).
- Sign off with a comma-ended close (e.g., "Thanks so much,") then "${clientName} Purchasing Team" on the next line.`;
  }
  return SYSTEM_BASE + `

SIGN-OFF FOR THIS EMAIL:
- The email is FROM ${ghostBrand} (a sourcing brand) reaching out on behalf of a buyer.
- Do NOT name the underlying client (${clientName}) anywhere in the email body.
- Sign off with a comma-ended close then "${ghostBrand} Sourcing" on the next line.`;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const MODEL = "claude-opus-4-5";  // Opus 4.5 — closest currently-supported family member to Opus 4.7 named in the original spec

export async function generateRevalidationEmail(opts: {
  mode: "active" | "ghost";
  clientName: string;
  ghostBrand?: string;
  userMessage: string;
}): Promise<{ draft: DraftPayload; usage: DraftUsage }> {
  const system = systemPromptFor(opts.mode, opts.clientName, opts.ghostBrand);
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: opts.userMessage }],
  });
  // First text block, parse the JSON object out of it.
  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const parsed = extractJsonObject(text);
  if (!parsed.subject || !parsed.body) {
    throw new Error(`Anthropic response missing subject/body. Raw text: ${text.slice(0, 400)}`);
  }
  return {
    draft: { subject: String(parsed.subject), body: String(parsed.body) },
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
  };
}

function extractJsonObject(text: string): any {
  // Accept either a bare JSON object or one wrapped in fences.
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  // Find the first { ... } span.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object found in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function formatUserMessage(group: {
  client_org_name: string;
  supplier_name: string;
  supplier_contact_name: string | null;
  rows: Array<{
    material_name: string;
    grade: any[] | null;
    quote_date: string | null;
    price: number | null;
    lead_time_days: number | null;
  }>;
}, mode: "active" | "ghost", ghostBrand: string | undefined): string {
  const materials = group.rows;
  const signoff = mode === "ghost"
    ? `${mode} (sign as ${ghostBrand} Sourcing)`
    : `${mode} (sign as ${group.client_org_name} Purchasing Team)`;
  const lines = [
    `Supplier company: ${group.supplier_name}`,
    `Supplier contact: ${group.supplier_contact_name ?? "—"}`,
    `Number of materials to re-validate: ${materials.length}`,
    `Classification mode: ${signoff}`,
    "",
    "Materials with last-quote date (and prev pricing / lead time if known):",
  ];
  for (const r of materials) {
    const qd = r.quote_date ? new Date(r.quote_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "unknown";
    const extras: string[] = [];
    if (r.price != null) extras.push(`prev $${r.price.toFixed(2)}`);
    if (r.lead_time_days != null) extras.push(`${r.lead_time_days}-day lead`);
    const suffix = extras.length ? ` [${extras.join(", ")}]` : "";
    const gradeStr = gradeToString(r.grade);
    const label = gradeStr ? `${r.material_name} (${gradeStr})` : r.material_name;
    lines.push(`  - ${label}, last quoted ${qd}${suffix}`);
  }
  return lines.join("\n") + "\n\nWrite the email.";
}

export function gradeToString(grade: any): string {
  if (!Array.isArray(grade)) return "";
  return grade.map((g) => (g && typeof g === "object" ? g.grade_name : null)).filter(Boolean).join(", ");
}
