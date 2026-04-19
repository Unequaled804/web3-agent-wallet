import type { Intent } from "../intent/schema.js";
import type { ValidationReport } from "../intent/validator.js";
import type { KillSwitch } from "../killswitch/state.js";

export type PolicyDecision = "approved" | "pending_approval" | "rejected";

export type PolicyEvaluation = {
  decision: PolicyDecision;
  reason: string;
  matched_rules: string[];
  requires_human_approval: boolean;
  evaluated_at: number;
};

export type PolicyConfig = {
  autoApproveMaxWei: bigint;
  hardMaxWei: bigint;
  allowedTo: Set<string>;
  blockedTo: Set<string>;
};

export class PolicyEngine {
  constructor(
    private readonly config: PolicyConfig,
    private readonly killSwitch: KillSwitch,
  ) {}

  evaluate(intent: Intent, validation: ValidationReport): PolicyEvaluation {
    const now = Date.now();
    const to = intent.to.toLowerCase();

    const decision = (
      kind: PolicyDecision,
      reason: string,
      matched_rules: string[],
    ): PolicyEvaluation => ({
      decision: kind,
      reason,
      matched_rules,
      requires_human_approval: kind === "pending_approval",
      evaluated_at: now,
    });

    if (!validation.ok) {
      return decision("rejected", "validation_failed", ["validation.ok == false"]);
    }

    if (this.killSwitch.isEnabled()) {
      return decision("rejected", "kill_switch_engaged", ["kill_switch.enabled == true"]);
    }

    if (this.config.blockedTo.has(to)) {
      return decision("rejected", "recipient_blocklisted", ["to in blocked list"]);
    }

    if (intent.value_wei > this.config.hardMaxWei) {
      return decision("rejected", "amount_above_hard_limit", [
        `value_wei (${intent.value_wei}) > hardMaxWei (${this.config.hardMaxWei})`,
      ]);
    }

    if (intent.action === "contract_call") {
      return decision("pending_approval", "contract_call_requires_human_review", [
        "action == contract_call",
      ]);
    }

    if (this.config.allowedTo.size > 0 && !this.config.allowedTo.has(to)) {
      return decision("pending_approval", "recipient_not_allowlisted", [
        "allowlist is configured",
        "to not in allowlist",
      ]);
    }

    if (intent.value_wei > this.config.autoApproveMaxWei) {
      return decision("pending_approval", "amount_above_auto_approve_limit", [
        `value_wei (${intent.value_wei}) > autoApproveMaxWei (${this.config.autoApproveMaxWei})`,
      ]);
    }

    return decision("approved", "within_auto_approve_policy", [
      `value_wei (${intent.value_wei}) <= autoApproveMaxWei (${this.config.autoApproveMaxWei})`,
    ]);
  }

  getConfigSnapshot() {
    return {
      auto_approve_max_wei: this.config.autoApproveMaxWei.toString(),
      hard_max_wei: this.config.hardMaxWei.toString(),
      allowed_to: [...this.config.allowedTo.values()],
      blocked_to: [...this.config.blockedTo.values()],
    };
  }
}
