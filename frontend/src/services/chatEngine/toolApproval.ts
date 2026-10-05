/**
 * Human-approval broker for tools that execute LLM-authored code.
 *
 * `run_strategy_code` is the only tool here so far. The chat engine yields a
 * `tool_confirm` event, then awaits `toolApproval.request(...)`; the UI renders the
 * code card from `toolApproval.pending` and calls `toolApproval.resolve(true|false)`.
 * Without an approval path (headless analysis scenarios, tests) the engine denies.
 *
 * A single pending request is enough: the tool loop awaits each confirmation
 * sequentially, so there is never more than one outstanding.
 */

import { ref, type Ref } from 'vue';

export interface ApprovalRequest {
  toolCallId: string;
  name: string;
  params: Record<string, unknown>;
}

const CONFIRM_REQUIRED = new Set(['run_strategy_code']);

/** Tools whose execution must be approved by the user first. */
export function requiresApproval(name: string): boolean {
  return CONFIRM_REQUIRED.has(name);
}

const pending: Ref<ApprovalRequest | null> = ref(null);
let resolver: ((approved: boolean) => void) | null = null;

export const toolApproval = {
  /** Currently awaiting approval, or null. Drives the UI card. */
  pending,
  /** Called by the engine: stores the request and returns a promise the UI resolves. */
  request(req: ApprovalRequest): Promise<boolean> {
    pending.value = req;
    return new Promise<boolean>((resolve) => {
      resolver = resolve;
    });
  },
  /** Called by the UI (run / cancel). No-op when nothing is pending. */
  resolve(approved: boolean): void {
    pending.value = null;
    const resolve = resolver;
    resolver = null;
    resolve?.(approved);
  },
};
