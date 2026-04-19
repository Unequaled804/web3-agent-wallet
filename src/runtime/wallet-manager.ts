import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { isHex, type Hex } from "viem";
import type { WalletContext } from "../context.js";
import type { AppConfig } from "../config.js";
import { createSigningClient } from "../chain/client.js";
import { resolveAuditDbPath } from "../audit/db-path.js";
import { AuditStore } from "../audit/store.js";
import { IntentStore } from "../intent/store.js";
import { ApprovalQueue } from "../approval/queue.js";
import { KillSwitch } from "../killswitch/state.js";
import { PolicyEngine } from "../policy/engine.js";
import { AgentBindingManager, type BindingState } from "../access/binding.js";
import {
  encryptPrivateKey,
  loadAccount,
  saveKeystore,
} from "../signer/keystore.js";

export type WalletDescriptor = {
  wallet_id: string;
  name: string;
  keystore_path: string;
  address: string;
  created_at: number;
  updated_at: number;
  last_used_at?: number;
};

type WalletRegistry = {
  version: 1;
  active_wallet_id?: string;
  wallets: WalletDescriptor[];
};

export type ActiveWalletSession = {
  wallet_id: string;
  name: string;
  address: string;
  keystore_path: string;
  db_path: string;
  loaded_at: number;
};

function sanitizeName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export class WalletRuntimeManager {
  private registry: WalletRegistry = { version: 1, wallets: [] };
  private session: ActiveWalletSession;

  private constructor(
    private readonly config: AppConfig,
    private readonly ctx: WalletContext,
    initialSession: ActiveWalletSession,
  ) {
    this.session = initialSession;
  }

  static async bootstrap(config: AppConfig, ctx: WalletContext): Promise<WalletRuntimeManager> {
    const manager = new WalletRuntimeManager(config, ctx, {
      wallet_id: "",
      name: "",
      address: ctx.account.address,
      keystore_path: config.KEYSTORE_PATH,
      db_path: "",
      loaded_at: Date.now(),
    });

    await manager.loadRegistry();

    const now = Date.now();
    const existing = manager.registry.wallets.find(
      (w) => w.keystore_path === config.KEYSTORE_PATH || w.address.toLowerCase() === ctx.account.address.toLowerCase(),
    );

    let wallet: WalletDescriptor;
    if (existing) {
      wallet = {
        ...existing,
        address: ctx.account.address,
        keystore_path: config.KEYSTORE_PATH,
        updated_at: now,
        last_used_at: now,
      };
      manager.registry.wallets = manager.registry.wallets.map((w) =>
        w.wallet_id === wallet.wallet_id ? wallet : w,
      );
    } else {
      wallet = {
        wallet_id: `wal_${randomUUID()}`,
        name: "default-wallet",
        keystore_path: config.KEYSTORE_PATH,
        address: ctx.account.address,
        created_at: now,
        updated_at: now,
        last_used_at: now,
      };
      manager.registry.wallets.push(wallet);
    }

    manager.registry.active_wallet_id = wallet.wallet_id;
    await manager.saveRegistry();

    const resolvedDb = resolveAuditDbPath(
      config.DB_PATH,
      ctx.account.address,
      config.INSTANCE_ID,
    );
    manager.session = {
      wallet_id: wallet.wallet_id,
      name: wallet.name,
      address: wallet.address,
      keystore_path: wallet.keystore_path,
      db_path: resolvedDb.dbPath,
      loaded_at: now,
    };

    return manager;
  }

  getSession(): ActiveWalletSession {
    return { ...this.session };
  }

  listWallets() {
    const active_wallet_id = this.registry.active_wallet_id;
    const wallets = this.registry.wallets.map((wallet) => ({
      ...wallet,
      is_active: wallet.wallet_id === active_wallet_id,
    }));
    return {
      instance_id: this.config.INSTANCE_ID,
      active_wallet_id,
      active_address: this.session.address,
      wallets,
    };
  }

  async createWallet(input: {
    name: string;
    password: string;
    private_key?: string;
    activate?: boolean;
  }): Promise<{
    wallet: WalletDescriptor;
    active_wallet_id: string;
    generated_private_key?: string;
  }> {
    const name = sanitizeName(input.name);
    if (!name) throw new Error("wallet name is required");
    if (!input.password) throw new Error("wallet password is required");

    const now = Date.now();
    const wallet_id = `wal_${randomUUID()}`;

    let privateKey: Hex;
    if (input.private_key) {
      if (!isHex(input.private_key) || input.private_key.length !== 66) {
        throw new Error("private_key must be a 0x-prefixed 32-byte hex string");
      }
      privateKey = input.private_key as Hex;
    } else {
      privateKey = generatePrivateKey();
    }

    const account = privateKeyToAccount(privateKey);
    const safeStem = slugify(name) || wallet_id.slice(4, 12);
    const keystore_path = join(this.config.WALLET_STORE_DIR, `${safeStem}-${wallet_id.slice(4, 12)}.json`);
    const keystore = await encryptPrivateKey(privateKey, input.password);
    await saveKeystore(keystore_path, keystore);

    const wallet: WalletDescriptor = {
      wallet_id,
      name,
      keystore_path,
      address: account.address,
      created_at: now,
      updated_at: now,
      last_used_at: input.activate ? now : undefined,
    };
    this.registry.wallets.push(wallet);

    if (input.activate) {
      await this.switchWallet({ wallet_id, password: input.password });
    } else {
      await this.saveRegistry();
    }

    return {
      wallet,
      active_wallet_id: this.registry.active_wallet_id ?? this.session.wallet_id,
      generated_private_key: input.private_key ? undefined : privateKey,
    };
  }

  async switchWallet(input: { wallet_id: string; password: string }): Promise<ActiveWalletSession> {
    const wallet = this.registry.wallets.find((w) => w.wallet_id === input.wallet_id);
    if (!wallet) {
      throw new Error(`wallet not found: ${input.wallet_id}`);
    }

    const account = await loadAccount(wallet.keystore_path, input.password);
    const resolvedDb = resolveAuditDbPath(
      this.config.DB_PATH,
      account.address,
      this.config.INSTANCE_ID,
    );

    await this.applySession(account, resolvedDb.dbPath);

    const now = Date.now();
    wallet.address = account.address;
    wallet.last_used_at = now;
    wallet.updated_at = now;

    this.registry.active_wallet_id = wallet.wallet_id;
    await this.saveRegistry();

    this.session = {
      wallet_id: wallet.wallet_id,
      name: wallet.name,
      address: wallet.address,
      keystore_path: wallet.keystore_path,
      db_path: resolvedDb.dbPath,
      loaded_at: now,
    };

    await this.ctx.auditStore.logEvent({
      event_type: "wallet_session_switched",
      status: "applied",
      from_address: account.address,
      payload: {
        instance_id: this.config.INSTANCE_ID,
        wallet_id: wallet.wallet_id,
        wallet_name: wallet.name,
      },
    });

    return this.getSession();
  }

  private async applySession(account: PrivateKeyAccount, dbPath: string) {
    const nextAudit = await AuditStore.open(dbPath);

    const persistedPolicy = nextAudit.getSetting<{
      auto_approve_max_wei?: string;
      hard_max_wei?: string;
      allowed_to?: string[];
      blocked_to?: string[];
      max_tx_per_minute?: number;
      max_tx_per_hour?: number;
    }>("policy_config")?.value;
    const persistedBinding = nextAudit.getSetting<BindingState>("binding_state")?.value;

    const nextKillSwitch = new KillSwitch();
    const nextPolicy = new PolicyEngine(
      {
        autoApproveMaxWei: this.config.POLICY_AUTO_APPROVE_MAX_WEI,
        hardMaxWei: this.config.POLICY_HARD_MAX_WEI,
        allowedTo: new Set(this.config.POLICY_ALLOWED_TO),
        blockedTo: new Set(this.config.POLICY_BLOCKED_TO),
        maxTxPerMinute: this.config.POLICY_MAX_TX_PER_MINUTE,
        maxTxPerHour: this.config.POLICY_MAX_TX_PER_HOUR,
      },
      nextKillSwitch,
    );

    if (persistedPolicy) {
      nextPolicy.applyUpdate({
        auto_approve_max_wei: persistedPolicy.auto_approve_max_wei,
        hard_max_wei: persistedPolicy.hard_max_wei,
        allowed_to: persistedPolicy.allowed_to,
        blocked_to: persistedPolicy.blocked_to,
        max_tx_per_minute: persistedPolicy.max_tx_per_minute,
        max_tx_per_hour: persistedPolicy.max_tx_per_hour,
      });
    }

    this.ctx.account = account;
    this.ctx.walletClient = createSigningClient(this.config.SEPOLIA_RPC_URL, account);
    this.ctx.auditStore = nextAudit;
    this.ctx.intentStore = new IntentStore();
    this.ctx.approvalQueue = new ApprovalQueue();
    this.ctx.killSwitch = nextKillSwitch;
    this.ctx.policyEngine = nextPolicy;
    this.ctx.bindingManager = new AgentBindingManager(persistedBinding);
  }

  private async loadRegistry() {
    await mkdir(dirname(this.config.WALLET_REGISTRY_PATH), { recursive: true });
    try {
      const raw = await readFile(this.config.WALLET_REGISTRY_PATH, "utf8");
      const parsed = JSON.parse(raw) as WalletRegistry;
      if (parsed.version !== 1 || !Array.isArray(parsed.wallets)) {
        throw new Error("registry format invalid");
      }
      this.registry = parsed;
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        this.registry = { version: 1, wallets: [] };
      } else if (error instanceof SyntaxError) {
        throw new Error(`wallet registry JSON parse error: ${error.message}`);
      } else if (error instanceof Error && error.message.includes("registry format")) {
        throw error;
      } else {
        throw error;
      }
    }
  }

  private async saveRegistry() {
    await mkdir(dirname(this.config.WALLET_REGISTRY_PATH), { recursive: true });
    await mkdir(this.config.WALLET_STORE_DIR, { recursive: true });
    await writeFile(
      this.config.WALLET_REGISTRY_PATH,
      JSON.stringify(this.registry, null, 2),
      "utf8",
    );
  }
}
