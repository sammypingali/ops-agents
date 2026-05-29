import { discoverContacts } from "@/agents-runtime/agents/data-enrichment/enrich";

// Calibration targets from Ben's run (GAP 1):
//   Shay & Company    -> sales@shayandcompany.com + +1 503-653-1155
//   Uniproma          -> info@uniproma.com
//   Naturallifeworth  -> sales@naturallifeworth.com
const SITES = [
  "https://www.shayandcompany.com",
  "https://www.uniproma.com",
  "https://www.naturallifeworth.com",
];

for (const site of SITES) {
  const t0 = Date.now();
  const d = await discoverContacts(site).catch((e) => ({ error: String(e) } as any));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== ${site}  (${secs}s) ===`);
  if ((d as any).error) {
    console.log("ERROR:", (d as any).error);
    continue;
  }
  console.log("pages_tried:", d.pages_tried, "any_ok:", d.any_ok);
  console.log("emails:", d.emails);
  console.log("phones:", d.phones);
  console.log("contact_url:", d.contact_url);
}
