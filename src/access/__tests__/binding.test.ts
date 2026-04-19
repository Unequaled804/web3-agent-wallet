import { describe, expect, it } from "vitest";
import { AgentBindingManager } from "../binding.js";

describe("AgentBindingManager", () => {
  it("binds and unbinds agent identity", () => {
    const manager = new AgentBindingManager();

    const bound = manager.bind({ agent_id: "test-agent", actor: "owner" });
    expect(bound.bound_agent_id).toBe("test-agent");
    expect(bound.bound_by).toBe("owner");
    expect(typeof bound.bound_at).toBe("number");

    const unbound = manager.unbind({ actor: "owner", reason: "rotate" });
    expect(unbound.bound_agent_id).toBeUndefined();
    expect(unbound.last_unbound_by).toBe("owner");
    expect(unbound.last_unbound_reason).toBe("rotate");
    expect(typeof unbound.last_unbound_at).toBe("number");
  });

  it("restores from persisted state", () => {
    const manager = new AgentBindingManager({
      bound_agent_id: "agent-1",
      bound_by: "ops",
      bound_at: 123,
    });

    expect(manager.getState()).toMatchObject({
      bound_agent_id: "agent-1",
      bound_by: "ops",
      bound_at: 123,
    });
  });
});
