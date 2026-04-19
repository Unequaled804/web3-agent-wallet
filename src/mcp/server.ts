#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.js";
import { createReadClient } from "../chain/client.js";
import { loadAccount } from "../signer/keystore.js";
import type { WalletContext } from "../context.js";
import { IntentStore } from "../intent/store.js";
import { registerGetAddress } from "./tools/get-address.js";
import { registerGetBalance } from "./tools/get-balance.js";
import { registerCreateIntent } from "./tools/create-intent.js";
import { registerSimulateIntent } from "./tools/simulate-intent.js";

// MCP uses stdout for protocol; all human-readable logs go to stderr.
const log = (...args: unknown[]) => console.error("[wallet]", ...args);

async function main() {
  const config = loadConfig();
  const account = await loadAccount(config.KEYSTORE_PATH, config.KEYSTORE_PASSWORD);
  const publicClient = createReadClient(config.SEPOLIA_RPC_URL);

  const intentStore = new IntentStore();
  const ctx: WalletContext = { account, publicClient, intentStore };

  const server = new McpServer({
    name: "web3-agent-wallet",
    version: "0.2.0",
  });

  registerGetAddress(server, ctx);
  registerGetBalance(server, ctx);
  registerCreateIntent(server, ctx);
  registerSimulateIntent(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(`connected. address=${account.address} chain=sepolia`);
}

main().catch((err) => {
  console.error("[wallet] fatal:", err);
  process.exit(1);
});
