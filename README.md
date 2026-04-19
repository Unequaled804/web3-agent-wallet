# web3-agent-wallet

An MCP-based Web3 wallet demo for AI Agents. Runs on Ethereum Sepolia testnet.

Agents (Claude Desktop / Claude Code / Cursor) interact with the wallet over the Model Context Protocol. The wallet holds the private key and enforces policy; the agent only proposes intents.

See [`docs/answers.md`](docs/answers.md) for the full design (user personas, key problems, architecture).

## Status

- [x] **M0** — MCP server skeleton, encrypted keystore, `wallet_get_address`, `wallet_get_balance`
- [x] **M1** — Intent layer: structured Intent, static+dynamic validation, human summary, eth_call simulation
- [x] **M2** — Policy engine + approval queue + kill switch
- [x] **M3** — Signing & broadcasting (`wallet_execute_intent`)
- [ ] M4 — Audit log & history query
- [ ] M5 — Session keys, ERC20, UI

## Prerequisites

- Node.js >= 20
- A Sepolia RPC URL (Alchemy, Infura, or the public `https://rpc.sepolia.org`)
- A Sepolia faucet drip for the wallet address (to actually send tx in later milestones)

## Setup

```bash
pnpm install            # or npm install
cp .env.example .env    # then edit .env
pnpm keystore:create    # generate or import a private key, encrypts to .wallet/keystore.json
pnpm build              # compile TypeScript
```

Edit `.env`:
- `SEPOLIA_RPC_URL` — your RPC endpoint
- `KEYSTORE_PASSWORD` — strong password for encrypting the keystore

> **Security note:** This is a demo. The keystore is a local AES-GCM encrypted JSON file with the password read from `.env`. Production deployments must use HSM / MPC / AA + secrets manager.

## Wire it into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "web3-agent-wallet": {
      "command": "node",
      "args": ["/absolute/path/to/web3-agent-wallet/dist/mcp/server.js"],
      "env": {
        "SEPOLIA_RPC_URL": "https://...",
        "KEYSTORE_PATH": "/absolute/path/to/.wallet/keystore.json",
        "KEYSTORE_PASSWORD": "..."
      }
    }
  }
}
```

Restart Claude Desktop; you should see these tools in the picker:

| Tool | Purpose | Side effects |
| --- | --- | --- |
| `wallet_get_address` | Wallet EOA address | None |
| `wallet_get_balance` | Sepolia ETH balance | None |
| `wallet_create_intent` | Propose a transaction; runs validation + policy decision (`approved` / `pending_approval` / `rejected`) | None (no signature) |
| `wallet_get_intent_status` | Query policy/approval status for a specific intent | None |
| `wallet_simulate_intent` | Dry-run a stored intent via `eth_call`, with latest validation snapshot | None |
| `wallet_list_approvals` | List intents waiting for human approval | None |
| `wallet_review_intent` | Approve or reject a pending intent | Updates in-memory intent status |
| `wallet_execute_intent` | Sign+broadcast an `approved` intent; can wait for receipt | Broadcasts transaction on Sepolia |
| `wallet_get_kill_switch` | Read kill-switch state + policy config | None |
| `wallet_set_kill_switch` | Engage/release emergency kill switch | Blocks new intents while engaged |

`wallet_create_intent` returns `intent_id`, `human_summary`, and policy status. Intents in `pending_approval` must pass `wallet_review_intent`, then `wallet_execute_intent` performs final preflight checks before signing/broadcasting.

## Dev

```bash
pnpm dev        # run via tsx (no build step)
pnpm typecheck
pnpm test
```

## Architecture

```
src/
├── mcp/          MCP server + tool definitions
├── intent/       zod schema, static+dynamic validator, humanize, in-memory store
├── chain/        viem clients (Sepolia) + eth_call simulator
├── policy/       policy engine (thresholds, allow/block list, risk grading)
├── approval/     in-memory human approval queue
├── killswitch/   emergency stop state
├── signer/       encrypted keystore
├── config.ts     env loading via zod
└── context.ts    shared runtime context (store + policy + queue + kill switch)
```

Later milestones will add `audit/`, `execution/`, and session-key features.
