import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const ConfigSchema = z.object({
  SEPOLIA_RPC_URL: z.string().url(),
  KEYSTORE_PATH: z.string().min(1),
  KEYSTORE_PASSWORD: z.string().min(1),
  DB_PATH: z.string().min(1).default("./.wallet/wallet.db"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

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
  return parsed.data;
}
