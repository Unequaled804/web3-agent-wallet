import type { PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { IntentStore } from "./intent/store.js";

export type WalletContext = {
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  intentStore: IntentStore;
};
