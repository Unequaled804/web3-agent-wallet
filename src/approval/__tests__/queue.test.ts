import { describe, expect, it } from "vitest";
import { ApprovalQueue } from "../queue.js";

describe("ApprovalQueue", () => {
  it("enqueues without duplicates", () => {
    const queue = new ApprovalQueue();
    queue.enqueue("int_1");
    queue.enqueue("int_1");
    queue.enqueue("int_2");

    expect(queue.list().map((entry) => entry.intent_id)).toEqual(["int_1", "int_2"]);
  });

  it("dequeues entries", () => {
    const queue = new ApprovalQueue();
    queue.enqueue("int_1");
    queue.enqueue("int_2");

    expect(queue.dequeue("int_1")).toBe(true);
    expect(queue.dequeue("int_1")).toBe(false);
    expect(queue.list().map((entry) => entry.intent_id)).toEqual(["int_2"]);
  });

  it("compacts stale intents", () => {
    const queue = new ApprovalQueue();
    queue.enqueue("int_1");
    queue.enqueue("int_2");

    queue.compact((id) => id === "int_2");
    expect(queue.list().map((entry) => entry.intent_id)).toEqual(["int_2"]);
  });
});
