import { randomUUID } from "node:crypto";
import type { Intent } from "./schema.js";

/**
 * In-memory intent store. Intents live here between create_intent and
 * execute_intent. M4 will add a SQLite mirror for audit; M2 will add status
 * transitions (pending_approval / approved / rejected / broadcast).
 *
 * Scoped to the current process lifetime on purpose: a restart should not
 * leave half-signed proposals lying around.
 */
export class IntentStore {
  private intents = new Map<string, Intent>();

  create(intent: Omit<Intent, "intent_id">): Intent {
    const intent_id = `int_${randomUUID()}`;
    const full: Intent = { ...intent, intent_id };
    this.intents.set(intent_id, full);
    return full;
  }

  get(intent_id: string): Intent | undefined {
    const intent = this.intents.get(intent_id);
    if (!intent) return undefined;
    if (intent.expires_at <= Date.now()) {
      this.intents.delete(intent_id);
      return undefined;
    }
    return intent;
  }

  list(): Intent[] {
    this.gc();
    return [...this.intents.values()].sort((a, b) => b.created_at - a.created_at);
  }

  delete(intent_id: string): boolean {
    return this.intents.delete(intent_id);
  }

  private gc() {
    const now = Date.now();
    for (const [id, intent] of this.intents) {
      if (intent.expires_at <= now) this.intents.delete(id);
    }
  }
}
