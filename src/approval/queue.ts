export type ApprovalQueueEntry = {
  intent_id: string;
  enqueued_at: number;
};

export class ApprovalQueue {
  private entries: ApprovalQueueEntry[] = [];

  enqueue(intent_id: string): void {
    if (this.entries.some((entry) => entry.intent_id === intent_id)) return;
    this.entries.push({ intent_id, enqueued_at: Date.now() });
  }

  dequeue(intent_id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.intent_id !== intent_id);
    return this.entries.length < before;
  }

  has(intent_id: string): boolean {
    return this.entries.some((entry) => entry.intent_id === intent_id);
  }

  list(): ApprovalQueueEntry[] {
    return [...this.entries];
  }

  compact(isLiveIntent: (intent_id: string) => boolean): void {
    this.entries = this.entries.filter((entry) => isLiveIntent(entry.intent_id));
  }
}
