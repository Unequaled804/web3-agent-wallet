export type BindingState = {
  bound_agent_id?: string;
  bound_by?: string;
  bound_at?: number;
  last_unbound_at?: number;
  last_unbound_by?: string;
  last_unbound_reason?: string;
};

export class AgentBindingManager {
  private state: BindingState;

  constructor(initial?: BindingState) {
    this.state = initial ? { ...initial } : {};
  }

  getState(): BindingState {
    return { ...this.state };
  }

  bind(input: { agent_id: string; actor?: string }): BindingState {
    this.state = {
      ...this.state,
      bound_agent_id: input.agent_id,
      bound_by: input.actor,
      bound_at: Date.now(),
    };
    return this.getState();
  }

  unbind(input?: { actor?: string; reason?: string }): BindingState {
    this.state = {
      ...this.state,
      bound_agent_id: undefined,
      bound_by: undefined,
      bound_at: undefined,
      last_unbound_at: Date.now(),
      last_unbound_by: input?.actor,
      last_unbound_reason: input?.reason,
    };
    return this.getState();
  }
}
