import path from "node:path";
import type { Address } from "viem";

export function resolveAuditDbPath(configuredDbPath: string, address: Address): {
  dbPath: string;
  mode: "placeholder" | "auto_wallet_suffix" | "literal";
} {
  const normalizedAddress = address.toLowerCase();

  if (configuredDbPath.includes("{address}")) {
    return {
      dbPath: configuredDbPath.replaceAll("{address}", normalizedAddress),
      mode: "placeholder",
    };
  }

  const base = path.basename(configuredDbPath).toLowerCase();
  if (base === "wallet.db") {
    const short = normalizedAddress.slice(2, 10);
    const derived = path.join(
      path.dirname(configuredDbPath),
      `wallet-${short}.db`,
    );
    return {
      dbPath: derived,
      mode: "auto_wallet_suffix",
    };
  }

  return {
    dbPath: configuredDbPath,
    mode: "literal",
  };
}
