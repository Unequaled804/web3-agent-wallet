#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.js";
import { createReadClient, createSigningClient } from "../chain/client.js";
import { loadAccount } from "../signer/keystore.js";
import type { WalletContext } from "../context.js";
import { IntentStore } from "../intent/store.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalQueue } from "../approval/queue.js";
import { KillSwitch } from "../killswitch/state.js";
import { registerGetAddress } from "./tools/get-address.js";
import { registerGetBalance } from "./tools/get-balance.js";
import { registerCreateIntent } from "./tools/create-intent.js";
import { registerSimulateIntent } from "./tools/simulate-intent.js";
import { registerListApprovals } from "./tools/list-approvals.js";
import { registerReviewIntent } from "./tools/review-intent.js";
import {
  registerGetKillSwitch,
  registerSetKillSwitch,
} from "./tools/kill-switch.js";
import { registerGetIntentStatus } from "./tools/get-intent-status.js";
import { registerExecuteIntent } from "./tools/execute-intent.js";

// MCP uses stdout for protocol; all human-readable logs go to stderr.
const log = (...args: unknown[]) => console.error("[wallet]", ...args);

async function main() {
  const config = loadConfig();
  const account = await loadAccount(config.KEYSTORE_PATH, config.KEYSTORE_PASSWORD);
  const publicClient = createReadClient(config.SEPOLIA_RPC_URL);
  const walletClient = createSigningClient(config.SEPOLIA_RPC_URL, account);

  const intentStore = new IntentStore();
  const killSwitch = new KillSwitch();
  const approvalQueue = new ApprovalQueue();
  const policyEngine = new PolicyEngine(
    {
      autoApproveMaxWei: config.POLICY_AUTO_APPROVE_MAX_WEI,
      hardMaxWei: config.POLICY_HARD_MAX_WEI,
      allowedTo: new Set(config.POLICY_ALLOWED_TO),
      blockedTo: new Set(config.POLICY_BLOCKED_TO),
    },
    killSwitch,
  );
  const ctx: WalletContext = {
    account,
    publicClient,
    walletClient,
    intentStore,
    policyEngine,
    approvalQueue,
    killSwitch,
  };

  const server = new McpServer({
    name: "web3-agent-wallet",
    version: "0.4.0",
  });

  registerGetAddress(server, ctx);
  registerGetBalance(server, ctx);
  registerCreateIntent(server, ctx);
  registerSimulateIntent(server, ctx);
  registerListApprovals(server, ctx);
  registerReviewIntent(server, ctx);
  registerGetKillSwitch(server, ctx);
  registerSetKillSwitch(server, ctx);
  registerGetIntentStatus(server, ctx);
  registerExecuteIntent(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(`connected. address=${account.address} chain=sepolia`);
}

main().catch((err) => {
  console.error("[wallet] fatal:", err);
  process.exit(1);
});
