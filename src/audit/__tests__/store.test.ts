import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditStore } from "../store.js";

const dirsToCleanup: string[] = [];

afterEach(async () => {
  while (dirsToCleanup.length > 0) {
    const dir = dirsToCleanup.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function setupDb() {
  const dir = await mkdtemp(join(tmpdir(), "wallet-audit-test-"));
  dirsToCleanup.push(dir);
  const dbPath = join(dir, "wallet.db");
  const store = await AuditStore.open(dbPath);
  return { store, dbPath };
}

describe("AuditStore", () => {
  it("writes and queries audit events", async () => {
    const { store } = await setupDb();

    await store.logEvent({
      event_type: "intent_created",
      intent_id: "int_1",
      request_id: "req_1",
      from_address: "0x1111111111111111111111111111111111111111",
      to_address: "0x2222222222222222222222222222222222222222",
      value_wei: "1000",
      status: "approved",
      payload: { source: "test" },
      occurred_at: 1_000,
    });

    await store.logEvent({
      event_type: "intent_confirmed",
      intent_id: "int_1",
      request_id: "req_1",
      status: "confirmed",
      tx_hash: "0xabc",
      payload: { block: 123 },
      occurred_at: 2_000,
    });

    const all = store.query({ limit: 10 });
    expect(all.length).toBe(2);
    expect(all[0]?.event_type).toBe("intent_confirmed");

    const byIntent = store.query({ intent_id: "int_1" });
    expect(byIntent.length).toBe(2);

    const byStatus = store.query({ status: "confirmed" });
    expect(byStatus.length).toBe(1);
    expect(byStatus[0]?.tx_hash).toBe("0xabc");

    const byAddress = store.query({
      address: "0x2222222222222222222222222222222222222222",
    });
    expect(byAddress.length).toBe(1);
    expect(byAddress[0]?.event_type).toBe("intent_created");

    const byTime = store.query({ from_time: 1_500, to_time: 2_500 });
    expect(byTime.length).toBe(1);
    expect(byTime[0]?.event_type).toBe("intent_confirmed");
  });

  it("persists rows to sqlite file across reopen", async () => {
    const { store, dbPath } = await setupDb();

    await store.logEvent({
      event_type: "kill_switch_changed",
      status: "engaged",
      payload: { reason: "manual" },
    });

    const reopened = await AuditStore.open(dbPath);
    const rows = reopened.query({ event_type: "kill_switch_changed" });
    expect(rows.length).toBe(1);
    expect(rows[0]?.payload).toMatchObject({ reason: "manual" });
  });
});
