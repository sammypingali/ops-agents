import { redirect } from "next/navigation";

// Global Price Pulse retired — the price benchmark now lives per-client on the
// Savings tab (client current-supply price vs the quotes we've collected).
export default function Page() {
  redirect("/home");
}
