# web3-agent-wallet

An MCP-based Web3 wallet demo for AI Agents. Runs on Ethereum Sepolia testnet.

Agents (Claude Desktop / Claude Code / Cursor) interact with the wallet over the Model Context Protocol. The wallet holds the private key and enforces policy; the agent only proposes intents.

See [`docs/answers.md`](docs/answers.md) for the full design (user personas, key problems, architecture).

## Status

- [x] **M0** — MCP server skeleton, encrypted keystore, `wallet_get_address`, `wallet_get_balance`
- [x] **M1** — Intent layer: structured Intent, static+dynamic validation, human summary, eth_call simulation
- [x] **M2** — Policy engine + approval queue + kill switch
- [x] **M3** — Signing & broadcasting (`wallet_execute_intent`)
- [x] **M4** — Audit log & history query (`wallet_query_history`)
- [x] **M5** — Human control plane: wallet-agent bind/unbind + runtime policy editing (including frequency limits)
- [x] **M5.5** — Local Web Console (create/switch wallet with password check, refresh balance, browse history, edit policy/binding)

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
- `INSTANCE_ID` — logical instance id. Use a unique value per local Agent process.
- `KEYSTORE_PASSWORD` — strong password for encrypting the keystore
- `DB_PATH` — SQLite audit DB path. Supports placeholders: `{address}` and `{instance}`.
  - Example (recommended for multi-instance): `./.wallet/{instance}-{address}.db`
- `WALLET_STORE_DIR` / `WALLET_REGISTRY_PATH` — optional overrides. By default these are auto-isolated per `INSTANCE_ID`.
- `WEB_CONSOLE_ENABLED` / `WEB_CONSOLE_HOST` / `WEB_CONSOLE_PORT` — local operator console settings.

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
| `wallet_query_history` | Query persisted audit/history events from SQLite | None |
| `wallet_get_binding` | Read wallet-agent binding state | None |
| `wallet_bind_agent` | Bind wallet to a specific `agent_id` | Persists binding state in SQLite |
| `wallet_unbind_agent` | Remove active binding | Persists binding state in SQLite |
| `wallet_get_policy` | Read effective policy config + runtime tx counters | None |
| `wallet_update_policy` | Update thresholds, allow/block lists, frequency limits | Persists policy config in SQLite |
| `wallet_get_console_url` | Return local Web Console URL | None |

`wallet_create_intent` returns `intent_id`, `human_summary`, and policy status. Intents in `pending_approval` must pass `wallet_review_intent`, then `wallet_execute_intent` performs final preflight checks before signing/broadcasting.

## Web Console (M5.5)

When `WEB_CONSOLE_ENABLED=true`, the server starts a local web UI:

- URL: `http://<WEB_CONSOLE_HOST>:<WEB_CONSOLE_PORT>/`
- `wallet_get_console_url` also returns the URL from MCP

The console supports:

1. Create a new wallet (generate or import private key).
2. Switch active local wallet with password verification.
3. View balance and refresh manually.
4. View recent transaction records and operation/audit logs.
5. Edit policy controls (amount thresholds, allow/block lists, frequency limits).
6. Bind/unbind active agent identity.

All console actions and MCP tool actions share the same runtime state in one process.

## M5 Human Interaction Model

M5 adds explicit human control surfaces beyond plain natural language prompts:

- Logical interaction:
  - Bind wallet to a single agent identity (`wallet_bind_agent`).
  - If bound, both `wallet_create_intent` and `wallet_execute_intent` require matching `agent_id`.
  - Unbind anytime (`wallet_unbind_agent`) to rotate or revoke authority.

- Operational interaction:
  - Read policy state (`wallet_get_policy`) and update policy live (`wallet_update_policy`).
  - Update amount thresholds, allow/block lists, and frequency guardrails (`max_tx_per_minute`, `max_tx_per_hour`).
  - Policy changes are persisted in SQLite and reloaded when MCP server restarts.
  - Operators can perform the same actions in Web Console (M5.5).

Quick example flow:

1. Bind current agent:
   - `wallet_bind_agent` with `{ "agent_id": "test-wallet", "actor": "owner" }`
2. Set frequency limits:
   - `wallet_update_policy` with `{ "max_tx_per_minute": 5, "max_tx_per_hour": 60, "actor": "owner" }`
3. Revoke binding:
   - `wallet_unbind_agent` with `{ "actor": "owner", "reason": "session ended" }`

## Multi-Agent On One Machine

Recommended pattern: one process per Agent, each with isolated local state.

1. Set a unique `INSTANCE_ID` for each process.
2. Use distinct `WEB_CONSOLE_PORT` values.
3. Use `DB_PATH` with `{instance}` placeholder (or distinct literal files).

This keeps wallets, audit logs, and operator consoles isolated while agents can still interact through on-chain transfers.

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
├── access/       wallet-agent binding state (bind/unbind)
├── runtime/      wallet registry + hot wallet session switching
├── web/          local web console server (operator UI + API)
├── approval/     in-memory human approval queue
├── killswitch/   emergency stop state
├── audit/        SQLite (sql.js) audit log store + history query
├── signer/       encrypted keystore
├── config.ts     env loading via zod
└── context.ts    shared runtime context (store + policy + queue + audit + kill switch)
```

See Chinese docs: [`README.zh-CN.md`](README.zh-CN.md)
