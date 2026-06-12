import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Root inside the authenticated app group. Inbox is the single cross-client
// landing surface for everyone in Control Room.
export default async function AppRoot() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect("/inbox");
}
