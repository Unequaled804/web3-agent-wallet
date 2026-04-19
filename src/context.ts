import type { PublicClient, WalletClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { IntentStore } from "./intent/store.js";
import type { PolicyEngine } from "./policy/engine.js";
import type { ApprovalQueue } from "./approval/queue.js";
import type { KillSwitch } from "./killswitch/state.js";

export type WalletContext = {
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  intentStore: IntentStore;
  policyEngine: PolicyEngine;
  approvalQueue: ApprovalQueue;
  killSwitch: KillSwitch;
};
