// Tiny CSV emitter. Quotes fields with double-quotes when they contain ",", `"`, or newline.
// Doubles internal quotes per RFC 4180. Boolean and null are rendered as "true"/"false"/"" .

export type CsvCell = string | number | boolean | null | undefined;

function escape(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  const s = typeof cell === "string" ? cell : String(cell);
  if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) lines.push(r.map(escape).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function filenameFor(orgSlug: string, itemType: string, date = new Date()): string {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return `tackle-box_${orgSlug}_${itemType}_${iso}.csv`;
}
