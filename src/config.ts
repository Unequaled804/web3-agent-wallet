import { config as loadEnv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

loadEnv({ path: path.resolve(PROJECT_ROOT, ".env") });

const ConfigSchema = z.object({
  SEPOLIA_RPC_URL: z.string().url(),
  KEYSTORE_PATH: z.string().min(1),
  KEYSTORE_PASSWORD: z.string().min(1),
  DB_PATH: z.string().min(1).default("./.wallet/wallet.db"),
  POLICY_AUTO_APPROVE_MAX_WEI: z
    .string()
    .regex(/^\d+$/)
    .default("10000000000000000"),
  POLICY_HARD_MAX_WEI: z
    .string()
    .regex(/^\d+$/)
    .default("200000000000000000"),
  POLICY_ALLOWED_TO: z.string().optional().default(""),
  POLICY_BLOCKED_TO: z.string().optional().default(""),
  POLICY_MAX_TX_PER_MINUTE: z
    .string()
    .regex(/^\d*$/)
    .default(""),
  POLICY_MAX_TX_PER_HOUR: z
    .string()
    .regex(/^\d*$/)
    .default(""),
});

export type AppConfig = {
  SEPOLIA_RPC_URL: string;
  KEYSTORE_PATH: string;
  KEYSTORE_PASSWORD: string;
  DB_PATH: string;
  POLICY_AUTO_APPROVE_MAX_WEI: bigint;
  POLICY_HARD_MAX_WEI: bigint;
  POLICY_ALLOWED_TO: string[];
  POLICY_BLOCKED_TO: string[];
  POLICY_MAX_TX_PER_MINUTE?: number;
  POLICY_MAX_TX_PER_HOUR?: number;
};

function parseAddressList(value: string, keyName: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      try {
        return getAddress(token).toLowerCase();
      } catch {
        throw new Error(
          `Invalid configuration. ${keyName} contains non-address value: ${token}`,
        );
      }
    });
}

function parseOptionalPositiveInt(value: string, keyName: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid configuration. ${keyName} must be a positive integer when provided.`,
    );
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid configuration. Check your .env file:\n${issues}`,
    );
  }

  const config = parsed.data;

  // Resolve paths relative to project root if they are relative.
  const resolvePath = (p: string) =>
    path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);

  return {
    SEPOLIA_RPC_URL: config.SEPOLIA_RPC_URL,
    KEYSTORE_PATH: resolvePath(config.KEYSTORE_PATH),
    KEYSTORE_PASSWORD: config.KEYSTORE_PASSWORD,
    DB_PATH: resolvePath(config.DB_PATH),
    POLICY_AUTO_APPROVE_MAX_WEI: BigInt(config.POLICY_AUTO_APPROVE_MAX_WEI),
    POLICY_HARD_MAX_WEI: BigInt(config.POLICY_HARD_MAX_WEI),
    POLICY_ALLOWED_TO: parseAddressList(
      config.POLICY_ALLOWED_TO,
      "POLICY_ALLOWED_TO",
    ),
    POLICY_BLOCKED_TO: parseAddressList(
      config.POLICY_BLOCKED_TO,
      "POLICY_BLOCKED_TO",
    ),
    POLICY_MAX_TX_PER_MINUTE: parseOptionalPositiveInt(
      config.POLICY_MAX_TX_PER_MINUTE,
      "POLICY_MAX_TX_PER_MINUTE",
    ),
    POLICY_MAX_TX_PER_HOUR: parseOptionalPositiveInt(
      config.POLICY_MAX_TX_PER_HOUR,
      "POLICY_MAX_TX_PER_HOUR",
    ),
  };
}
