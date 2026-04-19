import type { PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export type WalletContext = {
  account: PrivateKeyAccount;
  publicClient: PublicClient;
};
