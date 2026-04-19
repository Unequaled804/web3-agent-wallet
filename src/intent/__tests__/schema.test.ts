import { describe, it, expect } from "vitest";
import {
  CreateIntentInputShape,
  parseValueToWei,
  validateCreateIntentInput,
} from "../schema.js";
import { z } from "zod";

const Input = z.object(CreateIntentInputShape);

describe("parseValueToWei", () => {
  it("converts ether to wei", () => {
    expect(parseValueToWei({ amount: "1", unit: "ether" })).toBe(10n ** 18n);
    expect(parseValueToWei({ amount: "0.1", unit: "ether" })).toBe(10n ** 17n);
  });

  it("converts gwei to wei", () => {
    expect(parseValueToWei({ amount: "1", unit: "gwei" })).toBe(10n ** 9n);
  });

  it("passes wei through unchanged", () => {
    expect(parseValueToWei({ amount: "123456", unit: "wei" })).toBe(123456n);
  });

  it("rejects fractional wei", () => {
    expect(() => parseValueToWei({ amount: "0.5", unit: "wei" })).toThrow();
  });
});

describe("CreateIntentInputShape parsing", () => {
  it("accepts a well-formed transfer", () => {
    const parsed = Input.parse({
      action: "transfer",
      to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      value: { amount: "0.01", unit: "ether" },
    });
    expect(parsed.data).toBe("0x");
    expect(parsed.ttl_seconds).toBe(300);
  });

  it("rejects a non-hex address", () => {
    expect(() =>
      Input.parse({ action: "transfer", to: "not-an-address" }),
    ).toThrow();
  });

  it("rejects an amount with letters", () => {
    expect(() =>
      Input.parse({
        action: "transfer",
        to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        value: { amount: "abc", unit: "ether" },
      }),
    ).toThrow();
  });

  it("rejects an unknown unit", () => {
    expect(() =>
      Input.parse({
        action: "transfer",
        to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        value: { amount: "1", unit: "usd" as unknown as "ether" },
      }),
    ).toThrow();
  });
});

describe("validateCreateIntentInput cross-field rules", () => {
  const base = {
    to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const,
    value: { amount: "0", unit: "wei" as const },
    ttl_seconds: 300,
  };

  it("flags transfer with calldata", () => {
    const errs = validateCreateIntentInput({
      ...base,
      action: "transfer",
      data: "0xdeadbeef",
    });
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/transfer action must have data='0x'/);
  });

  it("flags contract_call without calldata", () => {
    const errs = validateCreateIntentInput({
      ...base,
      action: "contract_call",
      data: "0x",
    });
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/contract_call action requires non-empty calldata/);
  });

  it("passes a clean transfer", () => {
    expect(
      validateCreateIntentInput({ ...base, action: "transfer", data: "0x" }),
    ).toEqual([]);
  });
});
