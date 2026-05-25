import { redirect } from "next/navigation";
import { getSession, canSeeAgentTab } from "@/lib/auth";

// Root inside the authenticated app group: send everyone to /work by default.
// Monitors who never touch ops can flip to the Agents tab from the sidebar toggle.
export default async function AppRoot() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Account managers and operators always land in Work. Monitors/admins also land in Work
  // by default (Agents tab is one click away) — Work is the daily verb.
  redirect("/work");
}
