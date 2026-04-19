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
  maxTxPerMinute?: number;
  maxTxPerHour?: number;
};

export type PolicyConfigSnapshot = {
  auto_approve_max_wei: string;
  hard_max_wei: string;
  allowed_to: string[];
  blocked_to: string[];
  max_tx_per_minute?: number;
  max_tx_per_hour?: number;
};

export type PolicyUpdateInput = {
  auto_approve_max_wei?: string;
  hard_max_wei?: string;
  allowed_to?: string[];
  blocked_to?: string[];
  max_tx_per_minute?: number | null;
  max_tx_per_hour?: number | null;
};

export class PolicyEngine {
  private config: PolicyConfig;
  private recentBroadcastsAt: number[] = [];

  constructor(
    config: PolicyConfig,
    private readonly killSwitch: KillSwitch,
  ) {
    this.config = {
      autoApproveMaxWei: config.autoApproveMaxWei,
      hardMaxWei: config.hardMaxWei,
      allowedTo: new Set(config.allowedTo),
      blockedTo: new Set(config.blockedTo),
      maxTxPerMinute: config.maxTxPerMinute,
      maxTxPerHour: config.maxTxPerHour,
    };
  }

  evaluate(intent: Intent, validation: ValidationReport): PolicyEvaluation {
    const now = Date.now();
    const to = intent.to.toLowerCase();
    this.pruneBroadcasts(now);
    const minuteCount = this.countSince(now - 60_000);
    const hourCount = this.countSince(now - 3_600_000);

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

    if (
      this.config.maxTxPerMinute !== undefined &&
      minuteCount >= this.config.maxTxPerMinute
    ) {
      return decision("pending_approval", "frequency_limit_minute_exceeded", [
        `tx_count_last_minute (${minuteCount}) >= maxTxPerMinute (${this.config.maxTxPerMinute})`,
      ]);
    }

    if (
      this.config.maxTxPerHour !== undefined &&
      hourCount >= this.config.maxTxPerHour
    ) {
      return decision("pending_approval", "frequency_limit_hour_exceeded", [
        `tx_count_last_hour (${hourCount}) >= maxTxPerHour (${this.config.maxTxPerHour})`,
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

  getConfigSnapshot(): PolicyConfigSnapshot {
    return {
      auto_approve_max_wei: this.config.autoApproveMaxWei.toString(),
      hard_max_wei: this.config.hardMaxWei.toString(),
      allowed_to: [...this.config.allowedTo.values()],
      blocked_to: [...this.config.blockedTo.values()],
      max_tx_per_minute: this.config.maxTxPerMinute,
      max_tx_per_hour: this.config.maxTxPerHour,
    };
  }

  applyUpdate(input: PolicyUpdateInput): PolicyConfigSnapshot {
    const next: PolicyConfig = {
      autoApproveMaxWei: this.config.autoApproveMaxWei,
      hardMaxWei: this.config.hardMaxWei,
      allowedTo: new Set(this.config.allowedTo),
      blockedTo: new Set(this.config.blockedTo),
      maxTxPerMinute: this.config.maxTxPerMinute,
      maxTxPerHour: this.config.maxTxPerHour,
    };

    if (input.auto_approve_max_wei !== undefined) {
      next.autoApproveMaxWei = BigInt(input.auto_approve_max_wei);
    }
    if (input.hard_max_wei !== undefined) {
      next.hardMaxWei = BigInt(input.hard_max_wei);
    }
    if (input.allowed_to !== undefined) {
      next.allowedTo = new Set(input.allowed_to.map((v) => v.toLowerCase()));
    }
    if (input.blocked_to !== undefined) {
      next.blockedTo = new Set(input.blocked_to.map((v) => v.toLowerCase()));
    }
    if (input.max_tx_per_minute !== undefined) {
      next.maxTxPerMinute = input.max_tx_per_minute ?? undefined;
    }
    if (input.max_tx_per_hour !== undefined) {
      next.maxTxPerHour = input.max_tx_per_hour ?? undefined;
    }

    if (next.autoApproveMaxWei > next.hardMaxWei) {
      throw new Error("auto_approve_max_wei cannot exceed hard_max_wei");
    }

    this.config = next;
    return this.getConfigSnapshot();
  }

  recordBroadcast(at = Date.now()): void {
    this.recentBroadcastsAt.push(at);
    this.pruneBroadcasts(at);
  }

  getRuntimeSnapshot() {
    const now = Date.now();
    this.pruneBroadcasts(now);
    return {
      tx_count_last_minute: this.countSince(now - 60_000),
      tx_count_last_hour: this.countSince(now - 3_600_000),
    };
  }

  private pruneBroadcasts(now: number) {
    const hourAgo = now - 3_600_000;
    this.recentBroadcastsAt = this.recentBroadcastsAt.filter((ts) => ts >= hourAgo);
  }

  private countSince(since: number): number {
    return this.recentBroadcastsAt.filter((ts) => ts >= since).length;
  }
}
