// One-off trigger for Agent 11. Loaded with the ws polyfill so the Supabase
// realtime client doesn't reject Node 20.
import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;

async function main() {
  const { executeAgentRun } = await import("../src/agents-runtime/runtime");
  console.log("starting agent run…");
  const r = await executeAgentRun({
    agentSlug: "agent-11-lead-scanner-csv-push",
    triggerSource: "manual",
  });
  console.log("result:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("crashed:", e);
  process.exit(2);
});
