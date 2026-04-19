import { z } from "zod";
import { isAddress, isHex, parseUnits } from "viem";
import type { Address, Hex } from "viem";

/**
 * Intent is the structured proposal an Agent submits before a transaction is
 * signed. It's deliberately NOT free text — every field is typed and validated
 * so that LLM hallucinations (wrong unit, bad checksum, free-form amounts) are
 * caught before we ever touch a private key.
 */

export const SEPOLIA_CHAIN_ID = 11155111 as const;

// ---------- Input shape (what the Agent sends to wallet_create_intent) ----------

const ValueSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "amount must be a non-negative decimal string"),
    unit: z.enum(["wei", "gwei", "ether"]),
  })
  .describe(
    "Amount to transfer. Always explicit unit — never assume a default. Use unit='ether' for ETH, 'gwei' for fees, 'wei' for raw values.",
  );

const AddressSchema = z
  .string()
  .refine(isAddress, { message: "must be a valid EVM address (0x + 40 hex)" })
  .describe("EVM address (any case, will be checksummed)");

const HexDataSchema = z
  .string()
  .refine((v) => isHex(v), { message: "must be 0x-prefixed hex" })
  .describe("Calldata as 0x-prefixed hex; use '0x' for plain transfers");

/**
 * Exposed as a ZodRawShape so MCP SDK can consume it via `server.tool(name, desc, shape, handler)`.
 * Cross-field constraints (e.g. transfer must have empty calldata) are enforced
 * by {@link validateCreateIntentInput} after parsing.
 */
export const CreateIntentInputShape = {
  action: z
    .enum(["transfer", "contract_call"])
    .describe(
      "transfer: send native ETH. contract_call: invoke a contract with calldata.",
    ),
  to: AddressSchema,
  value: ValueSchema.default({ amount: "0", unit: "wei" }),
  data: HexDataSchema.default("0x"),
  request_id: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Correlation id spanning Agent reasoning → wallet execution. Server generates one if omitted.",
    ),
  note: z
    .string()
    .max(500)
    .optional()
    .describe("Short human-readable rationale from the Agent, for audit."),
  ttl_seconds: z.number().int().min(10).max(3600).default(300),
} as const;

const CreateIntentInputObject = z.object(CreateIntentInputShape);
export type CreateIntentInput = z.infer<typeof CreateIntentInputObject>;

export function validateCreateIntentInput(input: CreateIntentInput): string[] {
  const errors: string[] = [];
  if (input.action === "transfer" && input.data !== "0x") {
    errors.push("transfer action must have data='0x'");
  }
  if (input.action === "contract_call" && input.data === "0x") {
    errors.push("contract_call action requires non-empty calldata");
  }
  return errors;
}

// ---------- Simulate input shape ----------

export const SimulateIntentInputShape = {
  intent_id: z
    .string()
    .min(1)
    .describe("Intent id returned by wallet_create_intent."),
} as const;

// ---------- Normalised Intent (server-side representation) ----------

export type Intent = {
  intent_id: string;
  request_id: string;
  chain_id: typeof SEPOLIA_CHAIN_ID;
  action: "transfer" | "contract_call";
  from: Address;
  to: Address;
  value_wei: bigint;
  value_display: { amount: string; unit: "wei" | "gwei" | "ether" };
  data: Hex;
  created_at: number;
  expires_at: number;
  note?: string;
};

export function parseValueToWei(value: {
  amount: string;
  unit: "wei" | "gwei" | "ether";
}): bigint {
  const decimals = value.unit === "wei" ? 0 : value.unit === "gwei" ? 9 : 18;
  const dotIdx = value.amount.indexOf(".");
  if (dotIdx >= 0) {
    const fractionalDigits = value.amount.length - dotIdx - 1;
    if (fractionalDigits > decimals) {
      throw new Error(
        `amount ${value.amount} has more precision than ${value.unit} allows (max ${decimals} fractional digits)`,
      );
    }
  }
  return parseUnits(value.amount, decimals);
}
