export type KillSwitchSnapshot = {
  enabled: boolean;
  reason?: string;
  changed_at: number;
  changed_by?: string;
};

export class KillSwitch {
  private state: KillSwitchSnapshot = {
    enabled: false,
    changed_at: Date.now(),
    changed_by: "system",
  };

  isEnabled(): boolean {
    return this.state.enabled;
  }

  snapshot(): KillSwitchSnapshot {
    return { ...this.state };
  }

  engage(reason = "manual_engage", changed_by = "operator"): KillSwitchSnapshot {
    this.state = {
      enabled: true,
      reason,
      changed_at: Date.now(),
      changed_by,
    };
    return this.snapshot();
  }

  release(changed_by = "operator", reason = "manual_release"): KillSwitchSnapshot {
    this.state = {
      enabled: false,
      reason,
      changed_at: Date.now(),
      changed_by,
    };
    return this.snapshot();
  }
}
