import { getAddress } from "viem";
import type { WalletContext } from "../context.js";
import type { PolicyUpdateInput } from "./engine.js";

export type UpdatePolicyInput = PolicyUpdateInput & {
  actor?: string;
  reason?: string;
};

function normalizeAddressList(list?: string[]): string[] | undefined {
  if (list === undefined) return undefined;
  return list.map((value) => getAddress(value).toLowerCase());
}

export function getPolicyState(ctx: WalletContext) {
  return {
    policy: ctx.policyEngine.getConfigSnapshot(),
    runtime: ctx.policyEngine.getRuntimeSnapshot(),
  };
}

export async function updatePolicy(
  ctx: WalletContext,
  input: UpdatePolicyInput,
): Promise<
  | {
      ok: true;
      before: ReturnType<typeof ctx.policyEngine.getConfigSnapshot>;
      after: ReturnType<typeof ctx.policyEngine.getConfigSnapshot>;
      runtime: ReturnType<typeof ctx.policyEngine.getRuntimeSnapshot>;
    }
  | {
      ok: false;
      error: string;
      detail: string;
    }
> {
  const before = ctx.policyEngine.getConfigSnapshot();
  const validateLimit = (value: number | null | undefined, field: string) => {
    if (value === undefined || value === null) return;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${field} must be a positive integer or null`);
    }
  };

  try {
    validateLimit(input.max_tx_per_minute, "max_tx_per_minute");
    validateLimit(input.max_tx_per_hour, "max_tx_per_hour");
  } catch (error) {
    return {
      ok: false,
      error: "invalid_frequency_limit",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let normalizedAllowed: string[] | undefined;
  let normalizedBlocked: string[] | undefined;
  try {
    normalizedAllowed = normalizeAddressList(input.allowed_to);
    normalizedBlocked = normalizeAddressList(input.blocked_to);
  } catch (error) {
    return {
      ok: false,
      error: "invalid_address_list",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const after = ctx.policyEngine.applyUpdate({
      auto_approve_max_wei: input.auto_approve_max_wei,
      hard_max_wei: input.hard_max_wei,
      allowed_to: normalizedAllowed,
      blocked_to: normalizedBlocked,
      max_tx_per_minute: input.max_tx_per_minute,
      max_tx_per_hour: input.max_tx_per_hour,
    });

    await ctx.auditStore.setSetting("policy_config", after);
    await ctx.auditStore.logEvent({
      event_type: "policy_updated",
      status: "applied",
      payload: {
        actor: input.actor,
        reason: input.reason,
        before,
        after,
        patch: {
          auto_approve_max_wei: input.auto_approve_max_wei,
          hard_max_wei: input.hard_max_wei,
          allowed_to: normalizedAllowed,
          blocked_to: normalizedBlocked,
          max_tx_per_minute: input.max_tx_per_minute,
          max_tx_per_hour: input.max_tx_per_hour,
        },
      },
    });

    return {
      ok: true,
      before,
      after,
      runtime: ctx.policyEngine.getRuntimeSnapshot(),
    };
  } catch (error) {
    await ctx.auditStore.logEvent({
      event_type: "policy_update_failed",
      status: "rejected",
      payload: {
        actor: input.actor,
        reason: input.reason,
        error: error instanceof Error ? error.message : String(error),
        patch: input,
      },
    });

    return {
      ok: false,
      error: "policy_update_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
