"use client";

import { usePathname } from "next/navigation";

// Renders the Work or Agents sub-nav based on the live pathname. The two
// trees are rendered on the server (so they can read session/orgs) and
// handed in as JSX — we just pick which one to show.
export function NavSwitcher({ work, agents }: { work: React.ReactNode; agents: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  return <>{pathname.startsWith("/agents") ? agents : work}</>;
}
