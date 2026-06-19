// ---------------------------------------------------------------------------
// Kavi — Per-turn context budget audit
// ---------------------------------------------------------------------------
// Ring buffer of layer usage for debug surfaces and Settings diagnostics.
// ---------------------------------------------------------------------------

export type BudgetAuditLayer =
  | 'system'
  | 'tools'
  | 'messages'
  | 'memory_cacheable'
  | 'memory_dynamic'
  | 'goals';

export interface BudgetAuditEntry {
  conversationId: string;
  iteration: number;
  model: string;
  timestamp: number;
  layers: Record<BudgetAuditLayer, number>;
  totalTokens: number;
  contextWindow: number;
  compactionApplied?: boolean;
}

const MAX_BUDGET_AUDIT_ENTRIES = 128;
const auditEntries: BudgetAuditEntry[] = [];

export function recordBudgetAuditEntry(
  entry: Omit<BudgetAuditEntry, 'timestamp'>,
): BudgetAuditEntry {
  const stored: BudgetAuditEntry = {
    ...entry,
    timestamp: Date.now(),
  };
  auditEntries.push(stored);
  while (auditEntries.length > MAX_BUDGET_AUDIT_ENTRIES) {
    auditEntries.shift();
  }
  return stored;
}

export function getRecentBudgetAuditEntries(limit = 32): BudgetAuditEntry[] {
  const bounded = Math.max(1, Math.min(limit, MAX_BUDGET_AUDIT_ENTRIES));
  return auditEntries.slice(-bounded);
}

export function clearBudgetAuditForTests(): void {
  auditEntries.length = 0;
}