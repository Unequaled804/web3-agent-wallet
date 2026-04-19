#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.js";
import { createReadClient, createSigningClient } from "../chain/client.js";
import { loadAccount } from "../signer/keystore.js";
import type { WalletContext } from "../context.js";
import { IntentStore } from "../intent/store.js";
import { AuditStore } from "../audit/store.js";
import { resolveAuditDbPath } from "../audit/db-path.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalQueue } from "../approval/queue.js";
import { KillSwitch } from "../killswitch/state.js";
import { AgentBindingManager, type BindingState } from "../access/binding.js";
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
import { registerQueryHistory } from "./tools/query-history.js";
import { registerGetPolicy, registerUpdatePolicy } from "./tools/policy.js";
import {
  registerBindAgent,
  registerGetBinding,
  registerUnbindAgent,
} from "./tools/binding.js";

// MCP uses stdout for protocol; all human-readable logs go to stderr.
const log = (...args: unknown[]) => console.error("[wallet]", ...args);

async function main() {
  const config = loadConfig();
  const account = await loadAccount(config.KEYSTORE_PATH, config.KEYSTORE_PASSWORD);
  const publicClient = createReadClient(config.SEPOLIA_RPC_URL);
  const walletClient = createSigningClient(config.SEPOLIA_RPC_URL, account);
  const resolvedDb = resolveAuditDbPath(config.DB_PATH, account.address);
  const auditStore = await AuditStore.open(resolvedDb.dbPath);
  const persistedPolicy = auditStore.getSetting<{
    auto_approve_max_wei?: string;
    hard_max_wei?: string;
    allowed_to?: string[];
    blocked_to?: string[];
    max_tx_per_minute?: number;
    max_tx_per_hour?: number;
  }>("policy_config")?.value;
  const persistedBinding = auditStore.getSetting<BindingState>(
    "binding_state",
  )?.value;

  const intentStore = new IntentStore();
  const killSwitch = new KillSwitch();
  const approvalQueue = new ApprovalQueue();
  const policyEngine = new PolicyEngine(
    {
      autoApproveMaxWei: config.POLICY_AUTO_APPROVE_MAX_WEI,
      hardMaxWei: config.POLICY_HARD_MAX_WEI,
      allowedTo: new Set(config.POLICY_ALLOWED_TO),
      blockedTo: new Set(config.POLICY_BLOCKED_TO),
      maxTxPerMinute: config.POLICY_MAX_TX_PER_MINUTE,
      maxTxPerHour: config.POLICY_MAX_TX_PER_HOUR,
    },
    killSwitch,
  );
  if (persistedPolicy) {
    try {
      policyEngine.applyUpdate({
        auto_approve_max_wei: persistedPolicy.auto_approve_max_wei,
        hard_max_wei: persistedPolicy.hard_max_wei,
        allowed_to: persistedPolicy.allowed_to,
        blocked_to: persistedPolicy.blocked_to,
        max_tx_per_minute: persistedPolicy.max_tx_per_minute,
        max_tx_per_hour: persistedPolicy.max_tx_per_hour,
      });
    } catch (error) {
      log(
        "failed to load persisted policy_config, keeping env defaults:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const bindingManager = new AgentBindingManager(persistedBinding);
  const ctx: WalletContext = {
    account,
    publicClient,
    walletClient,
    intentStore,
    policyEngine,
    approvalQueue,
    killSwitch,
    auditStore,
    bindingManager,
  };

  const server = new McpServer({
    name: "web3-agent-wallet",
    version: "0.6.0",
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
  registerQueryHistory(server, ctx);
  registerGetPolicy(server, ctx);
  registerUpdatePolicy(server, ctx);
  registerGetBinding(server, ctx);
  registerBindAgent(server, ctx);
  registerUnbindAgent(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (resolvedDb.mode === "auto_wallet_suffix") {
    log(
      `DB_PATH=${config.DB_PATH} looked shared; auto-isolated audit db by wallet address: ${resolvedDb.dbPath}`,
    );
  } else if (resolvedDb.mode === "placeholder") {
    log(`audit db path resolved from placeholder: ${resolvedDb.dbPath}`);
  }

  log(`connected. address=${account.address} chain=sepolia`);
  if (persistedBinding?.bound_agent_id) {
    log(`active binding restored: ${persistedBinding.bound_agent_id}`);
  }
}

main().catch((err) => {
  console.error("[wallet] fatal:", err);
  process.exit(1);
});
