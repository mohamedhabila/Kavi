import { lookupE2EScenarioBenchmarkMeta } from '../../src/acceptance/e2eAgent/e2eBenchmarkRegistry';
import {
  E2E_LONG_TASK_SCENARIOS,
  LONG_TASK_EXPENSE_REPORT,
  LONG_TASK_RESUME_INTERRUPTED,
} from '../../src/acceptance/e2eAgent/scenariosLongTasks';
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

describe('long-task scenarios', () => {
  it('run with the rest of the suite, each with its own budgets and registration', () => {
    for (const scenario of E2E_LONG_TASK_SCENARIOS) {
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
    const rates = JSON.parse(seed(scenario, 'rates/fx-2026-09.json')).usd_per_unit as Record<
      string,
      number
    >;
    const totals: Record<string, number> = {};
    const leftOut: string[] = [];
    const flagged: string[] = [];
    for (const file of scenario.initialWorkspaceFiles ?? []) {
      if (!file.path.startsWith('receipts/')) continue;
      const receipt = JSON.parse(file.content);
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
    const grandTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);

    expect(containsTokens(scenario, 'reports/september-expenses.md').sort()).toEqual(
      [
        String(totals.travel),
        String(totals.meals),
        String(totals.lodging),
        String(grandTotal),
        ...flagged,
        ...leftOut,
      ].sort(),
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
