import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isHex, type Hex } from "viem";
import { encryptPrivateKey, saveKeystore } from "../signer/keystore.js";
import { loadConfig } from "../config.js";

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const config = loadConfig();

  console.log("Create an encrypted keystore at:", config.KEYSTORE_PATH);
  console.log("Options: [1] generate new private key  [2] import existing (hex)");
  const choice = await prompt("Choose [1/2]: ");

  let pk: Hex;
  if (choice === "2") {
    const input = await prompt("Enter 0x-prefixed private key: ");
    if (!isHex(input) || input.length !== 66) {
      throw new Error("Invalid private key (must be 0x + 64 hex chars)");
    }
    pk = input as Hex;
  } else {
    pk = generatePrivateKey();
    console.log("Generated new private key. Write it down as a backup:");
    console.log(pk);
  }

  const account = privateKeyToAccount(pk);
  console.log("Address:", account.address);

  const password = config.KEYSTORE_PASSWORD;
  if (password === "change-me") {
    throw new Error(
      "Refusing to use default KEYSTORE_PASSWORD. Set a real password in .env.",
    );
  }

  const keystore = await encryptPrivateKey(pk, password);
  await saveKeystore(config.KEYSTORE_PATH, keystore);
  console.log(`Saved keystore to ${config.KEYSTORE_PATH}`);
  console.log("Fund this address with Sepolia ETH from a faucet to get started.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
