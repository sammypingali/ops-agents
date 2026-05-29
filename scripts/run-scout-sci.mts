import { scoutSuppliersForMaterial, scoreScoutConfidence } from "@/agents-runtime/agents/lead-creator/scout";
import type { MaterialRow } from "@/agents-runtime/agents/lead-creator/sql";

const material: MaterialRow = {
  id: "manual-sci-test",
  name: "Sodium Cocoyl Isethionate",
  trade_name: null,
  inci: "Sodium Cocoyl Isethionate",
  created_at: new Date().toISOString(),
  user_id: null,
  tenkara_org_id: null,
};

const t0 = Date.now();
const results = await scoutSuppliersForMaterial(material, { log: (m) => console.error(`[scout] ${m}`) });
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.error(`\n=== ${results.length} live suppliers in ${secs}s ===`);

const byConf: Record<string, number> = {};
const byRole: Record<string, number> = {};
const bySite: Record<string, number> = {};
for (const s of results) {
  byConf[s.confidence_hint] = (byConf[s.confidence_hint] ?? 0) + 1;
  byRole[s.role ?? "?"] = (byRole[s.role ?? "?"] ?? 0) + 1;
  bySite[s.site_type ?? "?"] = (bySite[s.site_type ?? "?"] ?? 0) + 1;
}
console.error("confidence_hint:", byConf, "→ scores", {
  strong: scoreScoutConfidence("strong"),
  medium: scoreScoutConfidence("medium"),
  lead: scoreScoutConfidence("lead"),
});
console.error("role:", byRole);
console.error("site_type:", bySite);
console.error("with email:", results.filter((s) => s.email && /@/.test(s.email)).length, "/", results.length);

// Did we catch the majors Ben flagged?
const names = results.map((s) => `${s.supplier_name} ${s.trade_name ?? ""}`.toLowerCase());
for (const want of ["basf", "galaxy", "shay", "silver fern", "lerochem", "alexmo"]) {
  console.error(`  ${names.some((n) => n.includes(want)) ? "✓" : "✗"} ${want}`);
}

console.log(
  JSON.stringify(
    results.map((s) => ({ supplier: s.supplier_name, trade: s.trade_name, role: s.role, site: s.site_type, conf: s.confidence_hint, score: scoreScoutConfidence(s.confidence_hint), email: s.email, phone: s.phone })),
    null,
    2
  )
);
