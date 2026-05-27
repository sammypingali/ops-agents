"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function TabToggleClient() {
  const pathname = usePathname() ?? "";
  const tab: "work" | "agents" = pathname.startsWith("/agents") ? "agents" : "work";
  return (
    <div className="inline-flex rounded-full bg-secondary p-0.5 w-full">
      <Link
        href="/work"
        className={cn(
          "flex-1 text-center text-xs font-medium py-1.5 rounded-full transition-colors",
          tab === "work" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Your Work
      </Link>
      <Link
        href="/agents"
        className={cn(
          "flex-1 text-center text-xs font-medium py-1.5 rounded-full transition-colors",
          tab === "agents" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Agents
      </Link>
    </div>
  );
}
