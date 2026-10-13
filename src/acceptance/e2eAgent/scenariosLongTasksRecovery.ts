// ---------------------------------------------------------------------------
// Kavi — E2E long tasks that need the assistant to unblock itself
// ---------------------------------------------------------------------------
// Same grading as scenariosLongTasks.ts (final state, token and tool-call
// budgets at 1.5× the reference path written above each scenario), but each
// task hides an obstacle a capable assistant gets past on its own: the user
// names the wrong folder and one input is unreadable; thirty amounts must be
// totalled to the cent; an answer sits at the end of a chain of documents,
// the last of which overrides the rule the others point to.
// ---------------------------------------------------------------------------
import {
  completedTurnRubrics,
  longTaskBudgetRubrics,
  workspaceFileContains,
} from './longTaskRubrics';
import type { E2EScenario, E2EWorkspaceSeedFile } from './types';

// --- Wrong folder and an unreadable receipt --------------------------------

const OCTOBER_RECEIPTS: ReadonlyArray<
  readonly [id: string, category: string, amount: number, currency: string]
> = [
  ['R-1001', 'travel', 30, 'USD'],
  ['R-1002', 'meals', 40, 'EUR'],
  ['R-1003', 'lodging', 150, 'EUR'],
  ['R-1004', 'meals', 50, 'GBP'],
  ['R-1006', 'software', 20, 'USD'],
  ['R-1007', 'travel', 25, 'GBP'],
  ['R-1008', 'lodging', 100, 'EUR'],
];

const RECOVERY_EXPENSE_FILES: ReadonlyArray<E2EWorkspaceSeedFile> = [
  ...OCTOBER_RECEIPTS.map(([id, category, amount, currency]) => ({
    path: `receipts/2026-10/${id}.json`,
    content: JSON.stringify({ id, category, amount, currency }, null, 2),
  })),
  // Cut off mid-write: no amount survives, so the receipt cannot be reported.
  { path: 'receipts/2026-10/R-1005.json', content: '{\n  "id": "R-1005",\n  "categ' },
  {
    path: 'rates/fx-2026-10.json',
    content: JSON.stringify({ month: '2026-10', usd_per_unit: { USD: 1, EUR: 1.2, GBP: 1.4 } }),
  },
  {
    path: 'policy/expense-policy.md',
    content: [
      '# Expense policy',
      '- Convert every amount to USD with the rates file for the month in rates/.',
      '- Meals are reimbursed up to 60 USD per receipt. Cap anything above at 60 USD and flag the receipt.',
      '- A receipt that cannot be read is left out and listed by id for follow-up.',
      '- Report the USD total per category and the grand total, rounded to whole dollars.',
    ].join('\n'),
  },
];

/**
 * Reference path: wrong folder 1, find the receipts 1, policy 1, rates 1, receipts 8,
 * write 1 = 13 calls (14 with one more listing).
 */
export const LONG_TASK_RECOVER_WRONG_FOLDER: E2EScenario = {
  id: 'long-task-recover-wrong-folder',
  conversationId: 'e2e-long-task-recover',
  contentClass: 'synthetic_public',
  prompt:
    'Please do my October expense report. The receipts are in receipts/october and the rules are ' +
    'in policy/. Save it as reports/october-expenses.md.',
  initialWorkspaceFiles: RECOVERY_EXPENSE_FILES,
  rubrics: [
    ...completedTurnRubrics(0),
    ...workspaceFileContains('reports/october-expenses.md', [
      '108',
      '300',
      '493',
      'R-1004',
      'R-1005',
    ]),
    ...longTaskBudgetRubrics('long-task-recover-wrong-folder', 14),
  ],
};

// --- Thirty amounts to the cent --------------------------------------------

const MERCHANT_CATEGORIES: ReadonlyArray<readonly [merchant: string, category: string]> = [
  ['FreshMart', 'groceries'],
  ['GreenGrocer', 'groceries'],
  ['CityMetro', 'transport'],
  ['RideNow', 'transport'],
  ['Pasta Place', 'dining'],
  ['Sushi Corner', 'dining'],
  ['PowerGrid', 'utilities'],
  ['AquaWorks', 'utilities'],
  ['StreamFlix', 'subscriptions'],
  ['CloudBox', 'subscriptions'],
];

const TRANSACTIONS: ReadonlyArray<readonly [date: string, merchant: string, amount: string]> = [
  ['2026-10-01', 'FreshMart', '54.37'],
  ['2026-10-01', 'CityMetro', '2.90'],
  ['2026-10-02', 'StreamFlix', '12.99'],
  ['2026-10-03', 'Pasta Place', '38.50'],
  ['2026-10-04', 'GreenGrocer', '17.84'],
  ['2026-10-05', 'RideNow', '14.20'],
  ['2026-10-06', 'PowerGrid', '86.15'],
  ['2026-10-07', 'FreshMart', '61.08'],
  ['2026-10-08', 'CityMetro', '2.90'],
  ['2026-10-09', 'Sushi Corner', '44.75'],
  ['2026-10-10', 'CloudBox', '2.99'],
  ['2026-10-11', 'FreshMart', '23.46'],
  ['2026-10-12', 'RideNow', '9.85'],
  ['2026-10-12', 'RideNow', '9.85'],
  ['2026-10-13', 'AquaWorks', '31.40'],
  ['2026-10-14', 'GreenGrocer', '12.67'],
  ['2026-10-15', 'Pasta Place', '27.30'],
  ['2026-10-16', 'CityMetro', '2.90'],
  ['2026-10-17', 'FreshMart', '48.92'],
  ['2026-10-18', 'Sushi Corner', '52.10'],
  ['2026-10-19', 'RideNow', '18.65'],
  ['2026-10-20', 'FreshMart', '35.03'],
  ['2026-10-21', 'CityMetro', '2.90'],
  ['2026-10-22', 'Pasta Place', '41.25'],
  ['2026-10-23', 'StreamFlix', '12.99'],
  ['2026-10-23', 'StreamFlix', '12.99'],
  ['2026-10-25', 'GreenGrocer', '9.38'],
  ['2026-10-27', 'RideNow', '11.40'],
  ['2026-10-29', 'FreshMart', '57.61'],
  ['2026-10-30', 'Sushi Corner', '36.80'],
];

/** Reference path: export 1, categories 1, discovery 1, code 1, write 2 = 6 calls. */
export const LONG_TASK_EXACT_LEDGER: E2EScenario = {
  id: 'long-task-exact-ledger',
  conversationId: 'e2e-long-task-ledger',
  contentClass: 'synthetic_public',
  prompt:
    'Go through my bank export in finance/transactions-2026-10.csv. Using the merchant categories ' +
    'in finance/categories.csv, write what I spent per category to finance/october-by-category.csv ' +
    'as category,total lines with cents, counting every charge. Then write every charge that ' +
    'appears twice on the same day to finance/possible-duplicates.csv as date,merchant,amount lines.',
  initialWorkspaceFiles: [
    {
      path: 'finance/transactions-2026-10.csv',
      content: ['date,merchant,amount_eur', ...TRANSACTIONS.map((row) => row.join(','))].join('\n'),
    },
    {
      path: 'finance/categories.csv',
      content: ['merchant,category', ...MERCHANT_CATEGORIES.map((row) => row.join(','))].join('\n'),
    },
  ],
  rubrics: [
    ...completedTurnRubrics(0),
    ...workspaceFileContains('finance/october-by-category.csv', [
      'groceries,320.36',
      'transport,75.55',
      'dining,240.70',
      'utilities,117.55',
      'subscriptions,41.96',
    ]),
    ...workspaceFileContains('finance/possible-duplicates.csv', [
      '2026-10-12,RideNow,9.85',
      '2026-10-23,StreamFlix,12.99',
    ]),
    { kind: 'workspace_file', path: 'finance/possible-duplicates.csv', excludes: 'CityMetro' },
    ...longTaskBudgetRubrics('long-task-exact-ledger', 6),
  ],
};

// --- An answer at the end of a chain of documents --------------------------

const INVESTIGATION_FILES: ReadonlyArray<E2EWorkspaceSeedFile> = [
  {
    path: 'support/orders/A-7731.json',
    content: JSON.stringify({
      order: 'A-7731',
      item: 'Arc floor lamp',
      price_eur: 120,
      shipment: 'SHP-4410',
      refunded_eur: 36,
    }),
  },
  {
    path: 'support/orders/A-7713.json',
    content: JSON.stringify({
      order: 'A-7713',
      item: 'Desk lamp',
      price_eur: 45,
      shipment: 'SHP-4398',
      refunded_eur: 0,
    }),
  },
  {
    path: 'support/shipments/SHP-4410.json',
    content: JSON.stringify({
      shipment: 'SHP-4410',
      delivered: '2026-09-20',
      condition: 'damaged',
      damage_report: 'DR-981',
    }),
  },
  {
    path: 'support/damage-reports/DR-981.md',
    content:
      '# DR-981\n\nLamp shade cracked, base and wiring intact. Classified as partial damage ' +
      'under section 4.2 of the refund policy.',
  },
  {
    path: 'support/policy/refund-policy.md',
    content: [
      '# Refund policy',
      '4.1 Full damage: 100% of the item price.',
      '4.2 Partial damage: 30% of the item price.',
    ].join('\n'),
  },
  {
    path: 'support/policy/memo-2026-09-15.md',
    content:
      '# Policy memo, 15 September 2026\n\nFor orders delivered on or after 1 September 2026, ' +
      'partial damage under section 4.2 is refunded at 50% of the item price.',
  },
];

/**
 * Reference path: listing 1, order 1, shipment 1, damage report 1, policy folder 1, policy 1,
 * memo 1, write 1 = 8 calls.
 */
export const LONG_TASK_CHAINED_INVESTIGATION: E2EScenario = {
  id: 'long-task-chained-investigation',
  conversationId: 'e2e-long-task-investigation',
  contentClass: 'synthetic_public',
  prompt:
    'A customer is asking why order A-7731 was refunded only 36 EUR. Work out from the files in ' +
    'support/ what the refund should have been, and draft my reply in support/replies/A-7731.md. ' +
    'End it with the lines "Correct refund: <amount> EUR" and "Still owed: <amount> EUR".',
  initialWorkspaceFiles: INVESTIGATION_FILES,
  rubrics: [
    ...completedTurnRubrics(0),
    ...workspaceFileContains('support/replies/A-7731.md', ['Correct refund: 60', 'Still owed: 24']),
    ...longTaskBudgetRubrics('long-task-chained-investigation', 8),
  ],
};

export const E2E_LONG_TASK_RECOVERY_SCENARIOS: ReadonlyArray<E2EScenario> = [
  LONG_TASK_RECOVER_WRONG_FOLDER,
  LONG_TASK_EXACT_LEDGER,
  LONG_TASK_CHAINED_INVESTIGATION,
];
