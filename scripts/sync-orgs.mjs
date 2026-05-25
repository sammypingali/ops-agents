#!/usr/bin/env node
// Sync the org list from Tenkara prod (read-only) into the local OA orgs table.
// Idempotent: matches on tenkara_org_id (UUID) and upserts name + is_internal flag.
//
// Usage:
//   OA_DATABASE_URL=...  TENKARA_RO_DATABASE_URL=...  node scripts/sync-orgs.mjs
//
// Internal/testing orgs are detected by name pattern (case-insensitive): contains
// "internal" or "testing". The flag drives a dimmed/tagged treatment in the sidebar
// (see §6 of the change requests round 1).

import "dotenv/config";
import pg from "pg";

const tenkaraUrl = process.env.TENKARA_RO_DATABASE_URL;
const oaUrl = process.env.OA_DATABASE_URL;
if (!tenkaraUrl || !oaUrl) {
  console.error("Need TENKARA_RO_DATABASE_URL and OA_DATABASE_URL in .env.local");
  process.exit(1);
}

const t = new pg.Client({ connectionString: tenkaraUrl, ssl: { rejectUnauthorized: false } });
const o = new pg.Client({ connectionString: oaUrl, ssl: { rejectUnauthorized: false } });
await t.connect();
await o.connect();

const { rows } = await t.query("select id, name from public.organizations order by name");
console.log(`pulled ${rows.length} orgs from tenkara prod`);

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")             // drop "(Testing Org)" etc
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isInternal(name) {
  return /\b(internal|testing)\b/i.test(name);
}

for (const r of rows) {
  const slug = slugify(r.name);
  await o.query(
    `insert into public.orgs (tenkara_org_id, slug, name, is_internal)
       values ($1, $2, $3, $4)
       on conflict (tenkara_org_id) do update set name = excluded.name, is_internal = excluded.is_internal`,
    [r.id, slug, r.name, isInternal(r.name)]
  );
  console.log(` upserted ${slug} (${r.name}${isInternal(r.name) ? " — INTERNAL" : ""})`);
}

await t.end();
await o.end();
console.log("done.");
