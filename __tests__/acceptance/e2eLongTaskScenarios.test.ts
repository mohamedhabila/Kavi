import { lookupE2EScenarioBenchmarkMeta } from '../../src/acceptance/e2eAgent/e2eBenchmarkRegistry';
import {
  E2E_LONG_TASK_SCENARIOS,
  LONG_TASK_EXPENSE_REPORT,
  LONG_TASK_RESUME_INTERRUPTED,
} from '../../src/acceptance/e2eAgent/scenariosLongTasks';
import {
  E2E_LONG_TASK_RECOVERY_SCENARIOS,
  LONG_TASK_EXACT_LEDGER,
  LONG_TASK_RECOVER_WRONG_FOLDER,
} from '../../src/acceptance/e2eAgent/scenariosLongTasksRecovery';
import { E2E_AGENT_SCENARIOS } from '../../src/acceptance/e2eAgent/scenarios';
import { E2E_SCENARIO_TOKEN_BUDGETS } from '../../src/acceptance/e2eAgent/thresholds';
import type { E2ERubric, E2EScenario } from '../../src/acceptance/e2eAgent/types';

function seed(scenario: E2EScenario, path: string): string {
  const file = scenario.initialWorkspaceFiles?.find((entry) => entry.path === path);
  if (!file) throw new Error(`missing seed ${path}`);
  return file.content;
}

function containsTokens(scenario: E2EScenario, path: string): string[] {
  return scenario.rubrics.flatMap((rubric) =>
    rubric.kind === 'workspace_file' && rubric.path === path && rubric.contains
      ? [rubric.contains]
      : [],
  );
}

function parseCsv(text: string): Record<string, string>[] {
  const [header, ...rows] = text.trim().split('\n');
  const columns = header.split(',');
  return rows.map((row) =>
    Object.fromEntries(row.split(',').map((value, index) => [columns[index], value])),
  );
}

/** The expense policy applied to the seeded receipts, in whole USD per category. */
function expenseAnswer(scenario: E2EScenario, ratesPath: string) {
  const rates = JSON.parse(seed(scenario, ratesPath)).usd_per_unit as Record<string, number>;
  const totals: Record<string, number> = {};
  const leftOut: string[] = [];
  const flagged: string[] = [];
  for (const file of scenario.initialWorkspaceFiles ?? []) {
    if (!file.path.startsWith('receipts/')) continue;
    let receipt: { id: string; category: string; amount: number; currency: string };
    try {
      receipt = JSON.parse(file.content);
    } catch {
      leftOut.push(file.path.split('/').at(-1)!.replace('.json', ''));
      continue;
    }
    if (receipt.category === 'personal' || !(receipt.currency in rates)) {
      leftOut.push(receipt.id);
      continue;
    }
    let usd = receipt.amount * rates[receipt.currency];
    if (receipt.category === 'meals' && usd > 60) {
      usd = 60;
      flagged.push(receipt.id);
    }
    totals[receipt.category] = (totals[receipt.category] ?? 0) + usd;
  }
  const whole = (value: number) => String(Math.round(value));
  return {
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, whole(value)])),
    grandTotal: whole(Object.values(totals).reduce((sum, value) => sum + value, 0)),
    flagged,
    leftOut,
  };
}

describe('long-task scenarios', () => {
  it('run with the rest of the suite, each with its own budgets and registration', () => {
    for (const scenario of [...E2E_LONG_TASK_SCENARIOS, ...E2E_LONG_TASK_RECOVERY_SCENARIOS]) {
      expect(E2E_AGENT_SCENARIOS).toContain(scenario);
      expect(E2E_SCENARIO_TOKEN_BUDGETS[scenario.id]).toBeGreaterThan(0);
      const kinds = scenario.rubrics.map((rubric: E2ERubric) => rubric.kind);
      expect(kinds).toEqual(
        expect.arrayContaining(['graph_terminal_success', 'token_budget', 'tool_call_budget']),
      );
      expect(lookupE2EScenarioBenchmarkMeta(scenario.id).benchmarkFamilies).toContain(
        'kavi-long-task',
      );
    }
  });

  it('grade the expense report on the totals its own receipts, rates and policy produce', () => {
    const scenario = LONG_TASK_EXPENSE_REPORT;
    const answer = expenseAnswer(scenario, 'rates/fx-2026-09.json');

    expect(containsTokens(scenario, 'reports/september-expenses.md').sort()).toEqual(
      [
        answer.totals.travel,
        answer.totals.meals,
        answer.totals.lodging,
        answer.grandTotal,
        ...answer.flagged,
        ...answer.leftOut,
      ].sort(),
    );
  });

  it('grade the wrong-folder report on what its readable receipts produce', () => {
    const scenario = LONG_TASK_RECOVER_WRONG_FOLDER;
    const answer = expenseAnswer(scenario, 'rates/fx-2026-10.json');

    // The folder the user names does not exist; the receipts are elsewhere in the workspace.
    expect(scenario.prompt).toContain('receipts/october');
    expect(
      scenario.initialWorkspaceFiles?.some((file) => file.path.startsWith('receipts/october')),
    ).toBe(false);
    expect(answer.leftOut).toEqual(['R-1005']);
    expect(containsTokens(scenario, 'reports/october-expenses.md').sort()).toEqual(
      [
        answer.totals.meals,
        answer.totals.lodging,
        answer.grandTotal,
        ...answer.flagged,
        'R-1005',
      ].sort(),
    );
  });

  it('grade the ledger on exact cents and on charges that repeat on the same day', () => {
    const scenario = LONG_TASK_EXACT_LEDGER;
    const categoryOf = new Map(
      parseCsv(seed(scenario, 'finance/categories.csv')).map((row) => [row.merchant, row.category]),
    );
    const transactions = parseCsv(seed(scenario, 'finance/transactions-2026-10.csv'));
    const cents = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const row of transactions) {
      const category = categoryOf.get(row.merchant)!;
      cents.set(category, (cents.get(category) ?? 0) + Math.round(Number(row.amount_eur) * 100));
      const key = `${row.date},${row.merchant},${row.amount_eur}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const repeated = [...seen].filter(([, count]) => count > 1).map(([key]) => key);

    expect(containsTokens(scenario, 'finance/october-by-category.csv').sort()).toEqual(
      [...cents].map(([category, value]) => `${category},${(value / 100).toFixed(2)}`).sort(),
    );
    expect(containsTokens(scenario, 'finance/possible-duplicates.csv').sort()).toEqual(
      repeated.sort(),
    );
  });

  it('grade the resumed reconciliation on what its own inventory files produce', () => {
    const scenario = LONG_TASK_RESUME_INTERRUPTED;
    const onHand = new Map<string, number>();
    for (const path of ['inventory/warehouse-a.csv', 'inventory/warehouse-b.csv']) {
      for (const row of parseCsv(seed(scenario, path))) {
        onHand.set(row.sku, (onHand.get(row.sku) ?? 0) + Number(row.on_hand));
      }
    }
    const reorder = parseCsv(seed(scenario, 'inventory/reorder-points.csv'))
      .filter((row) => (onHand.get(row.sku) ?? 0) < Number(row.reorder_point))
      .map((row) => `${row.sku},${Number(row.target) - (onHand.get(row.sku) ?? 0)}`);
    const unitsToOrder = reorder.reduce((sum, line) => sum + Number(line.split(',')[1]), 0);

    // Steps 1 and 2 were finished correctly; step 3 stopped partway through the list.
    expect(parseCsv(seed(scenario, 'out/combined-stock.csv'))).toEqual(
      [...onHand].map(([sku, count]) => ({ sku, on_hand: String(count) })),
    );
    expect(seed(scenario, 'out/sold-out.txt').split('\n')).toEqual(
      [...onHand].filter(([, count]) => count === 0).map(([sku]) => sku),
    );
    const partial = seed(scenario, 'out/reorder-list.csv').split('\n').slice(1);
    expect(reorder.slice(0, partial.length)).toEqual(partial);
    expect(reorder.length).toBeGreaterThan(partial.length);

    const graded = containsTokens(scenario, 'out/reorder-list.csv');
    expect(reorder).toEqual(expect.arrayContaining(graded));
    expect(graded).toEqual(expect.arrayContaining(reorder.slice(partial.length)));
    expect(containsTokens(scenario, 'out/summary.md')).toEqual([`Units to order: ${unitsToOrder}`]);
  });
});
