import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { formatEther } from "viem";
import type { WalletContext } from "../context.js";
import type { AppConfig } from "../config.js";
import type { WalletRuntimeManager } from "../runtime/wallet-manager.js";
import { getPolicyState, updatePolicy } from "../policy/service.js";
import { bindAgent, getBindingState, unbindAgent } from "../access/service.js";

type ConsoleServerDeps = {
  config: AppConfig;
  ctx: WalletContext;
  walletManager: WalletRuntimeManager;
  log: (...args: unknown[]) => void;
};

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res: ServerResponse, statusCode: number, html: string) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const size = chunks.reduce((sum, part) => sum + part.length, 0);
    if (size > 1024 * 1024) {
      throw new Error("request body too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("invalid string field");
  return value;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("expected array of strings");
  return value.map((item) => {
    if (typeof item !== "string") throw new Error("expected array of strings");
    return item;
  });
}

const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Wallet Console</title>
  <style>
    :root {
      --bg0: #f5f4ee;
      --bg1: #e9ecf5;
      --panel: #ffffff;
      --ink: #1f2430;
      --muted: #667085;
      --line: #d7dde8;
      --accent: #0f6a5d;
      --accent-soft: #d8efe8;
      --warn: #9d5f00;
      --danger: #9d1a1a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Space Grotesk", "IBM Plex Sans", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 700px at 10% -10%, #c8d3ef 0%, transparent 60%),
        radial-gradient(1200px 600px at 100% 0%, #d8efe8 0%, transparent 50%),
        linear-gradient(180deg, var(--bg0), var(--bg1));
      min-height: 100vh;
    }
    .shell {
      max-width: 1180px;
      margin: 24px auto 48px;
      padding: 0 16px;
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 8px 24px rgba(27, 42, 75, 0.06);
      padding: 14px;
    }
    h1 {
      margin: 18px 16px 0;
      font-size: 28px;
      letter-spacing: 0.2px;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 16px;
    }
    .muted { color: var(--muted); font-size: 12px; }
    label { display: block; margin-top: 8px; font-size: 12px; color: var(--muted); }
    input, textarea, select, button {
      width: 100%;
      border-radius: 10px;
      border: 1px solid var(--line);
      padding: 9px 10px;
      font: inherit;
      margin-top: 4px;
    }
    textarea { min-height: 72px; }
    button {
      border: 0;
      background: var(--accent);
      color: #fff;
      cursor: pointer;
      font-weight: 600;
      margin-top: 10px;
    }
    button.alt { background: #334155; }
    button.warn { background: #8a5a00; }
    .inline { display: flex; gap: 8px; align-items: center; }
    .inline > * { flex: 1; }
    .mono { font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, monospace; font-size: 12px; word-break: break-all; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      text-align: left;
      padding: 8px 6px;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    .status {
      margin: 0 16px;
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--accent-soft);
      font-size: 12px;
      border: 1px solid #bce4d9;
    }
  </style>
</head>
<body>
  <h1>Agent Wallet Console</h1>
  <p id="status" class="status">Loading...</p>
  <div class="shell">
    <section class="card">
      <h2>Session</h2>
      <div id="sessionBox" class="mono"></div>
      <div class="inline">
        <button id="refreshStateBtn" class="alt">Refresh</button>
        <button id="refreshBalanceBtn" class="alt">Refresh Balance</button>
      </div>
      <div id="balanceBox" class="mono"></div>
    </section>

    <section class="card">
      <h2>Wallets</h2>
      <label>Available wallets</label>
      <select id="walletSelect"></select>
      <label>Password (required to switch)</label>
      <input id="switchPassword" type="password" autocomplete="off" />
      <button id="switchBtn">Switch Wallet</button>
      <hr style="border:none;border-top:1px solid var(--line);margin:12px 0;" />
      <h2>Create Wallet</h2>
      <label>Name</label>
      <input id="createName" placeholder="e.g. test-wallet-2" />
      <label>Password</label>
      <input id="createPassword" type="password" autocomplete="off" />
      <label>Private key (optional import)</label>
      <input id="createPk" placeholder="0x... (leave empty to generate)" />
      <label><input id="createActivate" type="checkbox" style="width:auto;margin-right:6px;" />Activate immediately</label>
      <button id="createBtn">Create Wallet</button>
      <pre id="createResult" class="mono"></pre>
    </section>

    <section class="card">
      <h2>Policy</h2>
      <label>auto_approve_max_wei</label>
      <input id="pAuto" />
      <label>hard_max_wei</label>
      <input id="pHard" />
      <label>max_tx_per_minute (empty to clear)</label>
      <input id="pMin" />
      <label>max_tx_per_hour (empty to clear)</label>
      <input id="pHour" />
      <label>allowed_to (comma separated addresses)</label>
      <textarea id="pAllow"></textarea>
      <label>blocked_to (comma separated addresses)</label>
      <textarea id="pBlock"></textarea>
      <button id="policySaveBtn">Save Policy</button>
      <pre id="policyBox" class="mono"></pre>
    </section>

    <section class="card">
      <h2>Binding</h2>
      <div id="bindingBox" class="mono"></div>
      <label>agent_id</label>
      <input id="bindAgentId" placeholder="test-wallet" />
      <button id="bindBtn">Bind Agent</button>
      <button id="unbindBtn" class="warn">Unbind Agent</button>
    </section>

    <section class="card" style="grid-column: 1 / -1;">
      <h2>Recent Transactions</h2>
      <div class="inline">
        <input id="txLimit" value="10" />
        <button id="txRefreshBtn" class="alt">Refresh</button>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Type</th><th>Status</th><th>Tx Hash</th><th>To</th><th>Value (wei)</th></tr></thead>
        <tbody id="txRows"></tbody>
      </table>
    </section>

    <section class="card" style="grid-column: 1 / -1;">
      <h2>Recent Operation Logs</h2>
      <div class="inline">
        <input id="opLimit" value="20" />
        <button id="opRefreshBtn" class="alt">Refresh</button>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>Status</th><th>Intent</th><th>Request</th><th>Notes</th></tr></thead>
        <tbody id="opRows"></tbody>
      </table>
    </section>
  </div>

<script>
const statusEl = document.getElementById('status');
const sessionBox = document.getElementById('sessionBox');
const balanceBox = document.getElementById('balanceBox');
const walletSelect = document.getElementById('walletSelect');
const createResult = document.getElementById('createResult');
const policyBox = document.getElementById('policyBox');
const bindingBox = document.getElementById('bindingBox');

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.background = isError ? '#ffe6e6' : '#d8efe8';
  statusEl.style.borderColor = isError ? '#f5bbbb' : '#bce4d9';
}

async function api(path, options) {
  const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
  const data = await res.json();
  if (!res.ok) {
    const err = data && data.error ? data.error : 'request_failed';
    throw new Error(err + (data && data.detail ? ': ' + data.detail : ''));
  }
  return data;
}

function ms(v) {
  if (!v) return '';
  return new Date(v).toLocaleString();
}

function shortHash(v) {
  if (!v) return '';
  if (v.length < 16) return v;
  return v.slice(0, 10) + '...' + v.slice(-8);
}

function splitCsv(text) {
  return text
    .split(',')
    .map(function (v) { return v.trim(); })
    .filter(Boolean);
}

async function refreshWallets() {
  const data = await api('/api/wallets');
  walletSelect.innerHTML = '';
  data.wallets.forEach(function (w) {
    const opt = document.createElement('option');
    opt.value = w.wallet_id;
    opt.textContent = (w.is_active ? '[active] ' : '') + w.name + ' - ' + w.address;
    walletSelect.appendChild(opt);
  });
  if (data.active_wallet_id) walletSelect.value = data.active_wallet_id;
}

async function refreshState() {
  const data = await api('/api/state');
  sessionBox.textContent = JSON.stringify(data.session, null, 2);
  balanceBox.textContent = JSON.stringify(data.balance, null, 2);
  policyBox.textContent = JSON.stringify(data.policy, null, 2);
  bindingBox.textContent = JSON.stringify(data.binding, null, 2);

  if (data.policy && data.policy.policy) {
    document.getElementById('pAuto').value = data.policy.policy.auto_approve_max_wei || '';
    document.getElementById('pHard').value = data.policy.policy.hard_max_wei || '';
    document.getElementById('pMin').value = data.policy.policy.max_tx_per_minute || '';
    document.getElementById('pHour').value = data.policy.policy.max_tx_per_hour || '';
    document.getElementById('pAllow').value = (data.policy.policy.allowed_to || []).join(',');
    document.getElementById('pBlock').value = (data.policy.policy.blocked_to || []).join(',');
  }
}

async function refreshBalanceOnly() {
  const data = await api('/api/balance');
  balanceBox.textContent = JSON.stringify(data, null, 2);
}

async function refreshHistory() {
  const txLimit = Number(document.getElementById('txLimit').value || 10);
  const opLimit = Number(document.getElementById('opLimit').value || 20);

  const tx = await api('/api/history?kind=transactions&limit=' + encodeURIComponent(String(txLimit)));
  const txRows = document.getElementById('txRows');
  txRows.innerHTML = '';
  tx.events.forEach(function (event) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + ms(event.occurred_at) + '</td>' +
      '<td>' + event.event_type + '</td>' +
      '<td>' + (event.status || '') + '</td>' +
      '<td title="' + (event.tx_hash || '') + '">' + shortHash(event.tx_hash || '') + '</td>' +
      '<td title="' + (event.to_address || '') + '">' + shortHash(event.to_address || '') + '</td>' +
      '<td>' + (event.value_wei || '') + '</td>';
    txRows.appendChild(tr);
  });

  const ops = await api('/api/history?kind=operations&limit=' + encodeURIComponent(String(opLimit)));
  const opRows = document.getElementById('opRows');
  opRows.innerHTML = '';
  ops.events.forEach(function (event) {
    const note = event.payload && event.payload.error ? String(event.payload.error) : '';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + ms(event.occurred_at) + '</td>' +
      '<td>' + event.event_type + '</td>' +
      '<td>' + (event.status || '') + '</td>' +
      '<td>' + shortHash(event.intent_id || '') + '</td>' +
      '<td>' + shortHash(event.request_id || '') + '</td>' +
      '<td>' + note + '</td>';
    opRows.appendChild(tr);
  });
}

async function bootstrap() {
  try {
    await refreshWallets();
    await refreshState();
    await refreshHistory();
    setStatus('Console ready. MCP and Web share one runtime state.', false);
  } catch (err) {
    setStatus('Bootstrap failed: ' + err.message, true);
  }
}

document.getElementById('refreshStateBtn').onclick = async function () {
  try {
    await refreshState();
    setStatus('State refreshed', false);
  } catch (err) {
    setStatus(err.message, true);
  }
};

document.getElementById('refreshBalanceBtn').onclick = async function () {
  try {
    await refreshBalanceOnly();
    setStatus('Balance refreshed', false);
  } catch (err) {
    setStatus(err.message, true);
  }
};

document.getElementById('switchBtn').onclick = async function () {
  try {
    await api('/api/wallets/switch', {
      method: 'POST',
      body: JSON.stringify({
        wallet_id: walletSelect.value,
        password: document.getElementById('switchPassword').value,
      }),
    });
    document.getElementById('switchPassword').value = '';
    await refreshWallets();
    await refreshState();
    await refreshHistory();
    setStatus('Wallet switched', false);
  } catch (err) {
    setStatus('Switch failed: ' + err.message, true);
  }
};

document.getElementById('createBtn').onclick = async function () {
  try {
    const created = await api('/api/wallets/create', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('createName').value,
        password: document.getElementById('createPassword').value,
        private_key: document.getElementById('createPk').value || undefined,
        activate: !!document.getElementById('createActivate').checked,
      }),
    });
    document.getElementById('createPassword').value = '';
    if (created.generated_private_key) {
      createResult.textContent = 'Generated private key (save securely):\n' + created.generated_private_key;
    } else {
      createResult.textContent = JSON.stringify(created.wallet, null, 2);
    }
    await refreshWallets();
    await refreshState();
    setStatus('Wallet created', false);
  } catch (err) {
    setStatus('Create failed: ' + err.message, true);
  }
};

document.getElementById('policySaveBtn').onclick = async function () {
  try {
    const minRaw = document.getElementById('pMin').value.trim();
    const hourRaw = document.getElementById('pHour').value.trim();
    await api('/api/policy', {
      method: 'POST',
      body: JSON.stringify({
        auto_approve_max_wei: document.getElementById('pAuto').value.trim() || undefined,
        hard_max_wei: document.getElementById('pHard').value.trim() || undefined,
        max_tx_per_minute: minRaw ? Number(minRaw) : null,
        max_tx_per_hour: hourRaw ? Number(hourRaw) : null,
        allowed_to: splitCsv(document.getElementById('pAllow').value),
        blocked_to: splitCsv(document.getElementById('pBlock').value),
      }),
    });
    await refreshState();
    setStatus('Policy updated', false);
  } catch (err) {
    setStatus('Policy update failed: ' + err.message, true);
  }
};

document.getElementById('bindBtn').onclick = async function () {
  try {
    await api('/api/binding/bind', {
      method: 'POST',
      body: JSON.stringify({ agent_id: document.getElementById('bindAgentId').value }),
    });
    await refreshState();
    setStatus('Agent bound', false);
  } catch (err) {
    setStatus('Bind failed: ' + err.message, true);
  }
};

document.getElementById('unbindBtn').onclick = async function () {
  try {
    await api('/api/binding/unbind', { method: 'POST', body: '{}' });
    await refreshState();
    setStatus('Agent unbound', false);
  } catch (err) {
    setStatus('Unbind failed: ' + err.message, true);
  }
};

document.getElementById('txRefreshBtn').onclick = refreshHistory;
document.getElementById('opRefreshBtn').onclick = refreshHistory;

bootstrap();
</script>
</body>
</html>`;

export async function startConsoleServer(deps: ConsoleServerDeps) {
  const { config, ctx, walletManager, log } = deps;

  const server = createServer(async (req, res) => {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: "bad_request" });
      return;
    }

    const url = new URL(req.url, `http://${config.WEB_CONSOLE_HOST}:${config.WEB_CONSOLE_PORT}`);

    try {
      if (req.method === "GET" && url.pathname === "/") {
        sendHtml(res, 200, CONSOLE_HTML);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/wallets") {
        sendJson(res, 200, walletManager.listWallets());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/wallets/create") {
        const body = await readJson(req);
        const result = await walletManager.createWallet({
          name: asString(body.name, "name"),
          password: asString(body.password, "password"),
          private_key: asOptionalString(body.private_key),
          activate: Boolean(body.activate),
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/wallets/switch") {
        const body = await readJson(req);
        const session = await walletManager.switchWallet({
          wallet_id: asString(body.wallet_id, "wallet_id"),
          password: asString(body.password, "password"),
        });
        sendJson(res, 200, { session });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/balance") {
        const wei = await ctx.publicClient.getBalance({ address: ctx.account.address });
        sendJson(res, 200, {
          chain: "sepolia",
          address: ctx.account.address,
          balance_wei: wei.toString(),
          balance_eth: formatEther(wei),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/policy") {
        sendJson(res, 200, getPolicyState(ctx));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/policy") {
        const body = await readJson(req);
        const result = await updatePolicy(ctx, {
          auto_approve_max_wei: asOptionalString(body.auto_approve_max_wei),
          hard_max_wei: asOptionalString(body.hard_max_wei),
          max_tx_per_minute:
            body.max_tx_per_minute === null || body.max_tx_per_minute === undefined
              ? body.max_tx_per_minute === null
                ? null
                : undefined
              : Number(body.max_tx_per_minute),
          max_tx_per_hour:
            body.max_tx_per_hour === null || body.max_tx_per_hour === undefined
              ? body.max_tx_per_hour === null
                ? null
                : undefined
              : Number(body.max_tx_per_hour),
          allowed_to: asOptionalStringArray(body.allowed_to),
          blocked_to: asOptionalStringArray(body.blocked_to),
          actor: "web-console",
        });

        if (!result.ok) {
          sendJson(res, 400, { error: result.error, detail: result.detail });
          return;
        }

        sendJson(res, 200, {
          before: result.before,
          after: result.after,
          runtime: result.runtime,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/binding") {
        sendJson(res, 200, await getBindingState(ctx));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/binding/bind") {
        const body = await readJson(req);
        const result = await bindAgent(ctx, {
          agent_id: asString(body.agent_id, "agent_id"),
          actor: "web-console",
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/binding/unbind") {
        const body = await readJson(req);
        const result = await unbindAgent(ctx, {
          actor: "web-console",
          reason: asOptionalString(body.reason),
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "20"), 1), 500);
        const kind = (url.searchParams.get("kind") ?? "operations").toLowerCase();
        const rows = ctx.auditStore.query({ limit });
        const events =
          kind === "transactions"
            ? rows.filter(
                (event) =>
                  Boolean(event.tx_hash) ||
                  event.event_type === "intent_broadcasted" ||
                  event.event_type === "intent_confirmed" ||
                  event.event_type === "intent_broadcast_failed",
              )
            : rows;
        sendJson(res, 200, { kind, count: events.length, events });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        const wei = await ctx.publicClient.getBalance({ address: ctx.account.address });
        sendJson(res, 200, {
          session: walletManager.getSession(),
          balance: {
            chain: "sepolia",
            address: ctx.account.address,
            balance_wei: wei.toString(),
            balance_eth: formatEther(wei),
          },
          policy: getPolicyState(ctx),
          binding: await getBindingState(ctx),
          kill_switch: ctx.killSwitch.snapshot(),
        });
        return;
      }

      sendJson(res, 404, { error: "not_found", path: url.pathname });
    } catch (error) {
      sendJson(res, 400, {
        error: "request_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.WEB_CONSOLE_PORT, config.WEB_CONSOLE_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  log(
    `web console ready at http://${config.WEB_CONSOLE_HOST}:${config.WEB_CONSOLE_PORT}/ (instance=${config.INSTANCE_ID})`,
  );

  return server;
}
