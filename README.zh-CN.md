# web3-agent-wallet（中文说明）

一个给 AI Agent 使用的 MCP 钱包 Demo，运行在 Ethereum Sepolia 测试网。

Agent（Claude Desktop / Claude Code / Cursor 等）通过 MCP 调用钱包工具。私钥始终由钱包进程持有，Agent 只能提交结构化意图（Intent），由策略引擎和审批机制决定是否执行。

完整设计背景见 [`docs/answers.md`](docs/answers.md)。

## 里程碑状态

- [x] **M0**：MCP 服务骨架、加密 keystore、`wallet_get_address`、`wallet_get_balance`
- [x] **M1**：Intent 层（结构化意图、静态/动态校验、人类可读摘要、模拟）
- [x] **M2**：策略引擎 + 审批队列 + Kill Switch
- [x] **M3**：签名与广播（`wallet_execute_intent`）
- [x] **M4**：审计日志与历史查询（`wallet_query_history`）
- [x] **M5**：人类控制面（绑定/解绑 + 策略实时调参，含频率限制）
- [x] **M5.5**：本地 Web 控制台（建钱包、切钱包验密、余额刷新、历史查看、策略/绑定配置）

## 环境要求

- Node.js >= 20
- Sepolia RPC（Alchemy / Infura / `https://rpc.sepolia.org`）
- 测试网 ETH（用于真实转账）

## 快速开始

```bash
pnpm install            # 或 npm install
cp .env.example .env    # 按需修改
pnpm keystore:create    # 生成/导入私钥，输出 .wallet/keystore.json
pnpm build
```

`.env` 关键项：

- `SEPOLIA_RPC_URL`：RPC 地址
- `INSTANCE_ID`：实例标识（建议同机每个 Agent 进程都不一样）
- `KEYSTORE_PATH`：keystore 路径
- `KEYSTORE_PASSWORD`：keystore 解密密码
- `DB_PATH`：SQLite 路径（支持 `{address}` 与 `{instance}` 占位）
  - 推荐：`./.wallet/{instance}-{address}.db`
- `WALLET_STORE_DIR` / `WALLET_REGISTRY_PATH`：可选覆盖。默认会按 `INSTANCE_ID` 自动隔离。
- `POLICY_*`：金额阈值、收款地址白/黑名单、频率限制
- `WEB_CONSOLE_*`：本地控制台开关、监听地址、端口

## MCP 工具一览

- `wallet_get_address`：查询钱包地址
- `wallet_get_balance`：查询 Sepolia ETH 余额
- `wallet_create_intent`：创建交易意图（不签名不广播）
- `wallet_get_intent_status`：查看意图状态
- `wallet_simulate_intent`：模拟执行意图
- `wallet_list_approvals`：查看待审批队列
- `wallet_review_intent`：人工审批通过/拒绝
- `wallet_execute_intent`：对已批准意图签名并广播
- `wallet_get_kill_switch` / `wallet_set_kill_switch`：查看/切换熔断
- `wallet_query_history`：查询审计日志
- `wallet_get_binding`：查看绑定状态
- `wallet_bind_agent`：绑定 Agent 身份
- `wallet_unbind_agent`：解绑 Agent 身份
- `wallet_get_policy`：查看当前策略与频率计数
- `wallet_update_policy`：更新策略参数（含频率限制）
- `wallet_get_console_url`：返回本地 Web 控制台地址

## Web 控制台（M5.5）

当 `WEB_CONSOLE_ENABLED=true` 时，会启动本地页面：

- 地址：`http://<WEB_CONSOLE_HOST>:<WEB_CONSOLE_PORT>/`
- 也可通过 MCP 工具 `wallet_get_console_url` 获取

控制台支持：

1. 新建钱包（自动生成或导入私钥）
2. 切换本地活跃钱包（需要密码验证）
3. 查询余额并手动刷新
4. 查看最近交易记录与审计操作日志
5. 可视化编辑风控参数（额度、白黑名单、频率限制）
6. 绑定/解绑 Agent 身份

同一实例内，Web 与 MCP 共享一套运行时状态，配置始终同步。

## M5 交互设计（重点）

### 1) 逻辑交互：绑定/解绑

- 使用 `wallet_bind_agent` 把钱包绑定到某个 `agent_id`
- 绑定后，`wallet_create_intent` 与 `wallet_execute_intent` 都必须带同一个 `agent_id`
- 使用 `wallet_unbind_agent` 可随时解除绑定（例如会话结束、Agent 轮换）

### 2) 实际交互：风控参数配置

- 使用 `wallet_get_policy` 查看当前策略与运行时频率计数
- 使用 `wallet_update_policy` 动态调整：
  - `auto_approve_max_wei`
  - `hard_max_wei`
  - `allowed_to` / `blocked_to`
  - `max_tx_per_minute` / `max_tx_per_hour`
- 所有策略变更会写入 SQLite，并在 MCP 服务重启时自动恢复
- 同样能力也可在 Web 控制台中直接操作

### 3) 审批队列行为

- 审批队列在内存中维护待审批 `intent_id`
- 只有审批通过后，`wallet_execute_intent` 才会签名并广播
- 对应决策与状态变化会落审计日志（持久化）

## 同机多 Agent 推荐方式

推荐一机多实例（每个 Agent 一个 `MCP + Web` 进程）：

1. 每个进程使用不同 `INSTANCE_ID`
2. 每个进程使用不同 `WEB_CONSOLE_PORT`
3. `DB_PATH` 使用 `{instance}` 占位避免冲突

这样本地状态隔离清晰，但 Agent 之间仍可通过链上转账等方式互相协作。

## 在 Claude Desktop 接入

`~/Library/Application Support/Claude/claude_desktop_config.json` 示例：

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

修改后重启 Claude Desktop。

## 开发命令

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

## 目录结构

```text
src/
├── mcp/          MCP server 与 tools
├── intent/       Intent schema、校验、摘要、存储
├── chain/        viem client 与模拟
├── policy/       策略引擎（额度、白黑名单、频率）
├── access/       绑定状态（bind/unbind）
├── runtime/      钱包注册表 + 运行时热切换
├── web/          本地 Web 控制台（操作页 + API）
├── approval/     人工审批队列
├── killswitch/   紧急熔断
├── audit/        SQLite 审计日志与设置持久化
├── signer/       加密 keystore
├── config.ts     环境配置解析
└── context.ts    运行时共享上下文
```
