import { describe, expect, it } from "vitest";
import { resolveAuditDbPath } from "../db-path.js";

const ADDRESS = "0xE5389a6ee05BE4282316daa622bE55ed9A632E6c" as const;

describe("resolveAuditDbPath", () => {
  it("expands {address} placeholder", () => {
    const resolved = resolveAuditDbPath("/.wallet/{address}.db", ADDRESS);
    expect(resolved.mode).toBe("placeholder");
    expect(resolved.dbPath).toBe("/.wallet/0xe5389a6ee05be4282316daa622be55ed9a632e6c.db");
  });

  it("auto-suffixes default wallet.db by wallet address", () => {
    const resolved = resolveAuditDbPath("/.wallet/wallet.db", ADDRESS);
    expect(resolved.mode).toBe("auto_wallet_suffix");
    expect(resolved.dbPath).toBe("/.wallet/wallet-e5389a6e.db");
  });

  it("keeps literal custom path unchanged", () => {
    const resolved = resolveAuditDbPath("/.wallet/agent-a.db", ADDRESS);
    expect(resolved.mode).toBe("literal");
    expect(resolved.dbPath).toBe("/.wallet/agent-a.db");
  });
});
