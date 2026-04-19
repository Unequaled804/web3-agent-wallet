import { formatEther, formatGwei } from "viem";
import type { Intent } from "./schema.js";
import type { ValidationReport } from "./validator.js";

/**
 * Turn a structured Intent into a human/Agent-readable summary. This is the
 * "speak it back" step that lets the Agent (or a human reviewer) catch the
 * "0.1 → 100" class of hallucinations before signing.
 */
export function humanize(intent: Intent, report?: ValidationReport): string {
  const lines: string[] = [];

  const valueEth = formatEther(intent.value_wei);
  const shortTo = `${intent.to.slice(0, 6)}…${intent.to.slice(-4)}`;

  if (intent.action === "transfer") {
    lines.push(
      `Transfer ${valueEth} ETH (${intent.value_wei} wei) to ${intent.to} (${shortTo}) on Sepolia.`,
    );
  } else {
    lines.push(
      `Call contract ${intent.to} (${shortTo}) on Sepolia with ${intent.data.length / 2 - 1} bytes of calldata, sending ${valueEth} ETH.`,
    );
  }

  if (intent.note) {
    lines.push(`Agent note: ${intent.note}`);
  }

  if (report?.estimated_fee_wei !== undefined && report.estimated_gas !== undefined) {
    lines.push(
      `Estimated gas: ${report.estimated_gas} units · fee ≈ ${formatEther(report.estimated_fee_wei)} ETH (${formatGwei(report.estimated_fee_wei)} gwei).`,
    );
  }

  if (report?.balance_wei !== undefined && report.total_cost_wei !== undefined) {
    const ok = report.balance_wei >= report.total_cost_wei;
    lines.push(
      `Balance: ${formatEther(report.balance_wei)} ETH · total cost: ${formatEther(report.total_cost_wei)} ETH · ${ok ? "SUFFICIENT" : "INSUFFICIENT"}.`,
    );
  }

  if (report && !report.ok) {
    const failed = report.checks.filter((c) => !c.pass);
    if (failed.length > 0) {
      lines.push(
        `⚠ Failed checks: ${failed.map((c) => `${c.name} (${c.detail ?? ""})`).join("; ")}`,
      );
    }
  }

  lines.push(
    `Intent ID: ${intent.intent_id} · expires ${new Date(intent.expires_at).toISOString()}.`,
  );

  return lines.join("\n");
}
