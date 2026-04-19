import type { WalletContext } from "../context.js";

export async function getBindingState(ctx: WalletContext) {
  return {
    binding: ctx.bindingManager.getState(),
  };
}

export async function bindAgent(
  ctx: WalletContext,
  input: { agent_id: string; actor?: string; reason?: string },
) {
  const before = ctx.bindingManager.getState();
  const after = ctx.bindingManager.bind({
    agent_id: input.agent_id,
    actor: input.actor,
  });

  await ctx.auditStore.setSetting("binding_state", after);
  await ctx.auditStore.logEvent({
    event_type: "agent_bound",
    status: "applied",
    payload: {
      actor: input.actor,
      reason: input.reason,
      before,
      after,
    },
  });

  return { before, after };
}

export async function unbindAgent(
  ctx: WalletContext,
  input?: { actor?: string; reason?: string },
) {
  const before = ctx.bindingManager.getState();
  const after = ctx.bindingManager.unbind({
    actor: input?.actor,
    reason: input?.reason,
  });

  await ctx.auditStore.setSetting("binding_state", after);
  await ctx.auditStore.logEvent({
    event_type: "agent_unbound",
    status: "applied",
    payload: {
      actor: input?.actor,
      reason: input?.reason,
      before,
      after,
    },
  });

  return { before, after };
}
