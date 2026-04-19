import { config as loadEnv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

loadEnv({ path: path.resolve(PROJECT_ROOT, ".env"), override: true });

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
  
  const config = parsed.data;
  
  // Resolve paths relative to project root if they are relative
  const resolvePath = (p: string) => path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
  
  config.KEYSTORE_PATH = resolvePath(config.KEYSTORE_PATH);
  config.DB_PATH = resolvePath(config.DB_PATH);
  
  return config;
}
