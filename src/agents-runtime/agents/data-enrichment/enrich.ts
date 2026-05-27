import { tenkaraQuery } from "@/lib/tenkara-readonly";

// Pre-outreach enrichment building blocks. No LLM, no Missive — those land
// when Agent 04 (Outreach) and Agent 08 (Email Scanner) ship.

export interface RawLead {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  material_name: string | null;
  payload: Record<string, any> | null;
}

export interface WebsiteProbe {
  url: string;
  ok: boolean;
  status_code: number | null;
  final_url: string | null;
  error?: string;
}

export interface EmailCheck {
  email: string;
  format_valid: boolean;
  // True when the email's domain matches the supplier_website's host (modulo www.).
  // Null when we can't compute (no website or invalid email).
  domain_matches_website: boolean | null;
}

export interface SupplierEnrichment {
  // From Tenkara `suppliers` — anything we didn't already have in payload.
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  poc_phone: string | null;
  shipping_email: string | null;
  billing_email: string | null;
  is_marketplace: boolean | null;
  responsiveness_score: number | null;
  payment_terms: any | null;
  supplier_type: string[] | null;
}

export interface EnrichmentResult {
  website_probe: WebsiteProbe | null;
  email_check: EmailCheck | null;
  tenkara_supplier: SupplierEnrichment | null;
  completeness_score: number; // 0..1
  // Fields we consider "minimum to outreach". When this is false we leave the
  // lead at stage=raw with payload.enrichment_blocked_reason set.
  outreach_ready: boolean;
  blocked_reason: string | null;
}

const PROBE_TIMEOUT_MS = 8_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function probeWebsite(url: string): Promise<WebsiteProbe> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    // HEAD first (cheap); fall back to GET if HEAD is disallowed.
    let res: Response;
    try {
      res = await fetch(target, { method: "HEAD", redirect: "follow", signal: ctl.signal });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(target, { method: "GET", redirect: "follow", signal: ctl.signal });
      }
    } catch (e) {
      res = await fetch(target, { method: "GET", redirect: "follow", signal: ctl.signal });
    }
    return {
      url: target,
      ok: res.ok,
      status_code: res.status,
      final_url: res.url || target,
    };
  } catch (e: any) {
    return {
      url: target,
      ok: false,
      status_code: null,
      final_url: null,
      error: e?.name === "AbortError" ? "timeout" : String(e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }
}

export function checkEmail(email: string, websiteUrl: string | null): EmailCheck {
  const format_valid = EMAIL_RE.test(email);
  let domain_matches_website: boolean | null = null;
  if (websiteUrl) {
    const emailHost = email.split("@")[1]?.toLowerCase().replace(/^www\./, "") ?? null;
    const siteHost = hostOf(websiteUrl);
    if (emailHost && siteHost) {
      domain_matches_website = emailHost === siteHost || emailHost.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${emailHost}`);
    }
  }
  return { email, format_valid, domain_matches_website };
}

export async function fetchTenkaraSupplier(supplierId: string): Promise<SupplierEnrichment | null> {
  const rows = await tenkaraQuery<any>(
    `select address, city, state, zip, country, poc_phone, shipping_email, billing_email,
            is_marketplace, responsiveness_score, payment_terms, supplier_type
       from public.suppliers where id = $1::uuid limit 1`,
    [supplierId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    address: r.address ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    zip: r.zip ?? null,
    country: r.country ?? null,
    poc_phone: r.poc_phone ?? null,
    shipping_email: r.shipping_email ?? null,
    billing_email: r.billing_email ?? null,
    is_marketplace: r.is_marketplace ?? null,
    responsiveness_score: r.responsiveness_score ?? null,
    payment_terms: r.payment_terms ?? null,
    supplier_type: r.supplier_type ?? null,
  };
}

// Cheap heuristic score from what we know. Weights chosen so a lead with a
// valid website + valid email + domain match + a phone clears ~0.8.
function scoreCompleteness(args: {
  websiteProbe: WebsiteProbe | null;
  emailCheck: EmailCheck | null;
  hasPhone: boolean;
  hasCountry: boolean;
}): number {
  let s = 0;
  if (args.websiteProbe?.ok) s += 0.35;
  else if (args.websiteProbe) s += 0.10; // we tried, didn't resolve
  if (args.emailCheck?.format_valid) s += 0.25;
  if (args.emailCheck?.domain_matches_website === true) s += 0.15;
  if (args.hasPhone) s += 0.10;
  if (args.hasCountry) s += 0.15;
  return Math.min(1, Math.round(s * 100) / 100);
}

export async function enrichLead(lead: RawLead): Promise<EnrichmentResult> {
  const payload = lead.payload ?? {};
  const website = payload.supplier_website as string | null;
  const email = payload.supplier_contact_email as string | null;

  const [website_probe, tenkara_supplier] = await Promise.all([
    website ? probeWebsite(website) : Promise.resolve(null),
    lead.supplier_id ? fetchTenkaraSupplier(lead.supplier_id).catch(() => null) : Promise.resolve(null),
  ]);

  const email_check = email ? checkEmail(email, website) : null;

  const completeness_score = scoreCompleteness({
    websiteProbe: website_probe,
    emailCheck: email_check,
    hasPhone: !!tenkara_supplier?.poc_phone,
    hasCountry: !!(tenkara_supplier?.country || payload.supplier_country),
  });

  // Minimum bar for outreach-ready: at least one viable contact channel.
  // "Viable email" = format-valid. We don't require domain match because some
  // suppliers legitimately use gmail/outlook addresses.
  const hasViableEmail = !!email_check?.format_valid;
  const hasViableWebsite = !!website_probe?.ok;
  const outreach_ready = hasViableEmail || hasViableWebsite;
  const blocked_reason = outreach_ready
    ? null
    : !email && !website
    ? "no_contact_channels"
    : !hasViableEmail && !hasViableWebsite
    ? "all_contact_channels_invalid"
    : null;

  return { website_probe, email_check, tenkara_supplier, completeness_score, outreach_ready, blocked_reason };
}
