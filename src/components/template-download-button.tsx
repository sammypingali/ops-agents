"use client";

import { Button } from "@/components/ui/button";
import { toCsv } from "@/lib/csv";

// Downloads a header-only CSV — a blank Tenkara-ready upload template for ops to
// fill by hand.
export function TemplateDownloadButton({
  headers,
  filename,
  label = "Download template",
}: {
  headers: readonly string[];
  filename: string;
  label?: string;
}) {
  function download() {
    const body = toCsv([...headers], []);
    const blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button size="sm" variant="ghost" onClick={download} title="Blank Tenkara-ready CSV template">
      {label}
    </Button>
  );
}
