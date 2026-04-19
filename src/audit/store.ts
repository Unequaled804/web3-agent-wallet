import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import initSqlJs, {
  type Database,
  type SqlJsStatic,
  type SqlValue,
} from "sql.js";

const require = createRequire(import.meta.url);

let sqlJsModulePromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJsModule(): Promise<SqlJsStatic> {
  if (!sqlJsModulePromise) {
    const sqlJsDistPath = dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
    sqlJsModulePromise = initSqlJs({
      locateFile: (file) => join(sqlJsDistPath, file),
    });
  }
  return sqlJsModulePromise;
}

export type AuditLogInput = {
  event_type: string;
  request_id?: string;
  intent_id?: string;
  chain_id?: number;
  from_address?: string;
  to_address?: string;
  value_wei?: string;
  status?: string;
  tx_hash?: string;
  payload?: Record<string, unknown>;
  occurred_at?: number;
};

export type AuditEvent = {
  id: number;
  event_id: string;
  occurred_at: number;
  event_type: string;
  request_id?: string;
  intent_id?: string;
  chain_id?: number;
  from_address?: string;
  to_address?: string;
  value_wei?: string;
  status?: string;
  tx_hash?: string;
  payload: Record<string, unknown>;
};

export type QueryAuditInput = {
  limit?: number;
  event_type?: string;
  intent_id?: string;
  request_id?: string;
  address?: string;
  status?: string;
  tx_hash?: string;
  from_time?: number;
  to_time?: number;
};

export type WalletSettingRecord<T> = {
  key: string;
  value: T;
  updated_at: number;
};

export class AuditStore {
  private constructor(
    private readonly dbPath: string,
    private readonly db: Database,
  ) {}

  static async open(dbPath: string): Promise<AuditStore> {
    await mkdir(dirname(dbPath), { recursive: true });

    const SQL = await loadSqlJsModule();

    let db: Database;
    try {
      const bytes = await readFile(dbPath);
      db = new SQL.Database(new Uint8Array(bytes));
    } catch (error) {
      const asNodeError = error as NodeJS.ErrnoException;
      if (asNodeError.code !== "ENOENT") throw error;
      db = new SQL.Database();
    }

    const store = new AuditStore(dbPath, db);
    store.migrate();
    await store.flush();

    return store;
  }

  async logEvent(input: AuditLogInput): Promise<AuditEvent> {
    const event_id = `evt_${randomUUID()}`;
    const occurred_at = input.occurred_at ?? Date.now();
    const payload = input.payload ?? {};

    this.db.run(
      [
        "INSERT INTO audit_events (",
        "  event_id, occurred_at, event_type, request_id, intent_id, chain_id,",
        "  from_address, to_address, value_wei, status, tx_hash, payload_json",
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join("\n"),
      [
        event_id,
        occurred_at,
        input.event_type,
        input.request_id ?? null,
        input.intent_id ?? null,
        input.chain_id ?? null,
        input.from_address ?? null,
        input.to_address ?? null,
        input.value_wei ?? null,
        input.status ?? null,
        input.tx_hash ?? null,
        JSON.stringify(payload),
      ],
    );

    await this.flush();

    const rows = this.queryRaw(
      "SELECT * FROM audit_events WHERE event_id = ? LIMIT 1",
      [event_id],
    );

    return rows[0]!;
  }

  query(input: QueryAuditInput = {}): AuditEvent[] {
    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (input.event_type) {
      conditions.push("event_type = ?");
      params.push(input.event_type);
    }
    if (input.intent_id) {
      conditions.push("intent_id = ?");
      params.push(input.intent_id);
    }
    if (input.request_id) {
      conditions.push("request_id = ?");
      params.push(input.request_id);
    }
    if (input.status) {
      conditions.push("status = ?");
      params.push(input.status);
    }
    if (input.tx_hash) {
      conditions.push("tx_hash = ?");
      params.push(input.tx_hash);
    }
    if (input.address) {
      const lc = input.address.toLowerCase();
      conditions.push("(lower(from_address) = ? OR lower(to_address) = ?)");
      params.push(lc, lc);
    }
    if (input.from_time !== undefined) {
      conditions.push("occurred_at >= ?");
      params.push(input.from_time);
    }
    if (input.to_time !== undefined) {
      conditions.push("occurred_at <= ?");
      params.push(input.to_time);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);

    const sql = [
      "SELECT *",
      "FROM audit_events",
      where,
      "ORDER BY occurred_at DESC, id DESC",
      "LIMIT ?",
    ]
      .filter(Boolean)
      .join("\n");

    return this.queryRaw(sql, [...params, limit]);
  }

  getSetting<T>(key: string): WalletSettingRecord<T> | undefined {
    const result = this.db.exec(
      "SELECT key, value_json, updated_at FROM wallet_settings WHERE key = ? LIMIT 1",
      [key],
    );
    if (result.length === 0) return undefined;
    const table = result[0]!;
    if (table.values.length === 0) return undefined;
    const row = table.values[0]!;
    const record = Object.fromEntries(
      table.columns.map((name, i) => [name, row[i] ?? null]),
    ) as Record<string, SqlValue>;

    const raw = record.value_json;
    if (typeof raw !== "string") return undefined;

    try {
      return {
        key,
        value: JSON.parse(raw) as T,
        updated_at: Number(record.updated_at ?? Date.now()),
      };
    } catch {
      return undefined;
    }
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const now = Date.now();
    this.db.run(
      [
        "INSERT INTO wallet_settings (key, value_json, updated_at)",
        "VALUES (?, ?, ?)",
        "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
      ].join("\n"),
      [key, JSON.stringify(value), now],
    );
    await this.flush();
  }

  private queryRaw(sql: string, params: SqlValue[]): AuditEvent[] {
    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    const table = result[0]!;
    return table.values.map((row) => {
      const entry = Object.fromEntries(
        table.columns.map((name, i) => [name, row[i] ?? null]),
      ) as Record<string, SqlValue>;

      const payloadRaw = entry.payload_json;
      let payload: Record<string, unknown> = {};
      if (typeof payloadRaw === "string") {
        try {
          payload = JSON.parse(payloadRaw) as Record<string, unknown>;
        } catch {
          payload = { parse_error: true, raw: payloadRaw };
        }
      }

      return {
        id: Number(entry.id),
        event_id: String(entry.event_id),
        occurred_at: Number(entry.occurred_at),
        event_type: String(entry.event_type),
        request_id: nullableString(entry.request_id),
        intent_id: nullableString(entry.intent_id),
        chain_id: entry.chain_id === null ? undefined : Number(entry.chain_id),
        from_address: nullableString(entry.from_address),
        to_address: nullableString(entry.to_address),
        value_wei: nullableString(entry.value_wei),
        status: nullableString(entry.status),
        tx_hash: nullableString(entry.tx_hash),
        payload,
      };
    });
  }

  private migrate(): void {
    this.db.run(
      [
        "CREATE TABLE IF NOT EXISTS audit_events (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  event_id TEXT NOT NULL UNIQUE,",
        "  occurred_at INTEGER NOT NULL,",
        "  event_type TEXT NOT NULL,",
        "  request_id TEXT,",
        "  intent_id TEXT,",
        "  chain_id INTEGER,",
        "  from_address TEXT,",
        "  to_address TEXT,",
        "  value_wei TEXT,",
        "  status TEXT,",
        "  tx_hash TEXT,",
        "  payload_json TEXT NOT NULL",
        ")",
      ].join("\n"),
    );

    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON audit_events(occurred_at)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_audit_intent_id ON audit_events(intent_id)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_events(request_id)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_audit_tx_hash ON audit_events(tx_hash)",
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_events(event_type)",
    );

    this.db.run(
      [
        "CREATE TABLE IF NOT EXISTS wallet_settings (",
        "  key TEXT PRIMARY KEY,",
        "  value_json TEXT NOT NULL,",
        "  updated_at INTEGER NOT NULL",
        ")",
      ].join("\n"),
    );
  }

  private async flush(): Promise<void> {
    const bytes = this.db.export();
    await writeFile(this.dbPath, Buffer.from(bytes));
  }
}

function nullableString(value: SqlValue | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}
