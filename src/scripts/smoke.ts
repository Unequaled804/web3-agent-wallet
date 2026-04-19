import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { formatEther } from "viem";
import {
  decryptPrivateKey,
  encryptPrivateKey,
  loadKeystore,
  saveKeystore,
} from "../signer/keystore.js";
import { createReadClient } from "../chain/client.js";

async function main() {
  const password = "smoke-test-password";
  const path = "./.wallet/smoke.json";

  console.error("[smoke] generating pk");
  const pk = generatePrivateKey();
  const addr = privateKeyToAccount(pk).address;

  console.error("[smoke] encrypt + save keystore");
  await saveKeystore(path, await encryptPrivateKey(pk, password));

  console.error("[smoke] load + decrypt keystore");
  const round = await decryptPrivateKey(await loadKeystore(path), password);
  if (round !== pk) throw new Error("keystore roundtrip mismatch");

  console.error("[smoke] decrypt with wrong password should fail");
  try {
    await decryptPrivateKey(await loadKeystore(path), "nope");
    throw new Error("expected wrong-password decrypt to throw");
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("wrong password")) throw e;
  }

  console.error("[smoke] read balance from Sepolia");
  const client = createReadClient(
    process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org",
  );
  const bal = await client.getBalance({ address: addr });
  console.error(`[smoke] address=${addr} balance=${formatEther(bal)} ETH`);

  console.error("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
