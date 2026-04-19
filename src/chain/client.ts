import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { sepolia } from "viem/chains";
import type { PrivateKeyAccount } from "viem/accounts";

export const CHAIN = sepolia;

export function createReadClient(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl),
  });
}

export function createSigningClient(
  rpcUrl: string,
  account: PrivateKeyAccount,
): WalletClient {
  return createWalletClient({
    chain: CHAIN,
    transport: http(rpcUrl),
    account,
  });
}
