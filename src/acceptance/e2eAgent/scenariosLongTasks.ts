// ---------------------------------------------------------------------------
// Kavi — E2E long tasks: complex everyday work graded on outcome and efficiency
// ---------------------------------------------------------------------------
// Each scenario is a natural request whose inputs sit in the workspace, so the
// assistant has to find them, reason across many files, resolve a trap (a stale
// fact, a distractor, an interrupted run, a changed requirement) and deliver
// every artifact in one go. Grading reads only the final state, plus two
// budgets: total tokens and total tool calls. Each tool-call budget is 1.5× the
// reference path written above the scenario, so a run that wanders, rereads or
// retries pays for it while a run that batches its reads stays well inside.
//
// The harness approves every tool, so approval prompts never interrupt a run,
// and it counts only the conversation's own tool calls: a delegated worker's
// calls are not in the tool-call budget, but its model calls are in the tokens.
// ---------------------------------------------------------------------------
import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2ERubric, E2EScenario, E2EWorkspaceSeedFile } from './types';

function completedTurnRubrics(turnIndex: number): E2ERubric[] {
  return [
    { kind: 'turn_completion', turnIndex, field: 'execution', expected: true },
    { kind: 'turn_completion', turnIndex, field: 'final_response', expected: true },
    { kind: 'turn_completion', turnIndex, field: 'agent_run', expected: true },
  ];
}

function budgetRubrics(scenarioId: string, referenceToolCalls: number): E2ERubric[] {
  return [
    { kind: 'graph_terminal_success' },
    { kind: 'token_budget', maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS[scenarioId] },
    { kind: 'tool_call_budget', maxToolCalls: Math.ceil(referenceToolCalls * 1.5) },
  ];
}

function fileContains(path: string, tokens: ReadonlyArray<string>): E2ERubric[] {
  return tokens.map((contains) => ({ kind: 'workspace_file', path, contains }));
}

// --- Expense report --------------------------------------------------------

const RECEIPTS: ReadonlyArray<
  readonly [
    id: string,
    date: string,
    merchant: string,
    category: string,
    amount: number,
    currency: string,
  ]
> = [
  ['R-0901', '2026-09-02', 'City Taxi', 'travel', 48, 'USD'],
  ['R-0902', '2026-09-03', 'Hotel Arcada', 'lodging', 160, 'EUR'],
  ['R-0903', '2026-09-03', 'Brasserie Nord', 'meals', 56, 'EUR'],
  ['R-0904', '2026-09-08', 'Rail Link', 'travel', 36, 'GBP'],
  ['R-0905', '2026-09-09', 'Noodle Bar', 'meals', 24, 'USD'],
  ['R-0906', '2026-09-10', 'Diagram Cloud', 'software', 16, 'USD'],
  ['R-0907', '2026-09-14', 'Airport Shuttle', 'travel', 30, 'XYZ'],
  ['R-0908', '2026-09-15', 'Hotel Arcada', 'lodging', 120, 'EUR'],
  ['R-0909', '2026-09-16', 'Gift Shop', 'personal', 40, 'EUR'],
  ['R-0910', '2026-09-21', 'Station Cafe', 'meals', 12, 'GBP'],
  ['R-0911', '2026-09-22', 'Notes Pro', 'software', 12, 'EUR'],
  ['R-0912', '2026-09-28', 'Ride Share', 'travel', 80, 'USD'],
];

const EXPENSE_FILES: ReadonlyArray<E2EWorkspaceSeedFile> = [
  ...RECEIPTS.map(([id, date, merchant, category, amount, currency]) => ({
    path: `receipts/2026-09/${id}.json`,
    content: JSON.stringify({ id, date, merchant, category, amount, currency }, null, 2),
  })),
  {
    path: 'rates/fx-2026-09.json',
    content: JSON.stringify({ month: '2026-09', usd_per_unit: { USD: 1, EUR: 1.25, GBP: 1.5 } }),
  },
  {
    path: 'policy/expense-policy.md',
    content: [
      '# Expense policy',
      '- Convert every amount to USD with the rates file for the month in rates/.',
      '- Meals are reimbursed up to 60 USD per receipt. Cap anything above at 60 USD and flag the receipt.',
      '- Personal purchases are not reimbursable. Leave them out and list their receipt ids.',
      '- A receipt in a currency with no rate cannot be converted. Leave it out and list its id for follow-up.',
      '- Report the USD total per category and the grand total, rounded to whole dollars.',
    ].join('\n'),
  },
];

/** Reference path: list 1, policy 1, rates 1, receipts 12, write 1 = 16 calls. */
export const LONG_TASK_EXPENSE_REPORT: E2EScenario = {
  id: 'long-task-expense-report',
  conversationId: 'e2e-long-task-expense',
  contentClass: 'synthetic_public',
  prompt:
    'Please put together my September expense report. The receipts are in receipts/2026-09 and the ' +
    'rules are in policy/. Save it as reports/september-expenses.md.',
  initialWorkspaceFiles: EXPENSE_FILES,
  rubrics: [
    ...completedTurnRubrics(0),
    ...fileContains('reports/september-expenses.md', [
      '182',
      '102',
      '350',
      '665',
      'R-0903',
      'R-0907',
      'R-0909',
    ]),
    ...budgetRubrics('long-task-expense-report', 16),
  ],
};

// --- Trip sheet, calendar and message --------------------------------------

const TRIP_FILES: ReadonlyArray<E2EWorkspaceSeedFile> = [
  {
    path: 'inbox/01-booking-confirmation.txt',
    content:
      'From: Lumo Air bookings\nSubject: Booking KV7Q2 confirmed\n\nFlight KV 212 Amsterdam (AMS) to ' +
      'Lisbon (LIS) on 21 Oct 2026. Departs 08:10 UTC, arrives 10:55 UTC. Booking reference KV7Q2.',
  },
  {
    path: 'inbox/02-hotel.txt',
    content:
      'From: Hotel Miradouro\nSubject: Your reservation\n\nReservation HTL-55821. Check-in 21 Oct ' +
      '2026, check-out 24 Oct 2026. Breakfast included.',
  },
  {
    path: 'inbox/03-newsletter.txt',
    content:
      'From: Lumo Air deals\nSubject: Autumn sale\n\nLisbon from 49 EUR on flight KV 300! Use promo ' +
      'code AUTUMN30 before 31 Oct.',
  },
  {
    path: 'inbox/04-schedule-change.txt',
    content:
      'From: Lumo Air bookings\nSubject: Schedule change for booking KV7Q2\n\nFlight KV 212 on 21 Oct ' +
      '2026 has been cancelled. You are rebooked on flight KV 418 from Amsterdam (AMS) to Lisbon ' +
      '(LIS) on 21 Oct 2026, departing 11:40 UTC and arriving 14:25 UTC. Your booking reference ' +
      'stays KV7Q2.',
  },
  {
    path: 'inbox/05-car-rental.txt',
    content:
      'From: Ponte Cars\nSubject: Rental confirmed\n\nRental CAR-30417. Pick-up at Lisbon airport on ' +
      '21 Oct 2026, drop-off 24 Oct 2026.',
  },
  {
    path: 'inbox/06-return-flight.txt',
    content:
      'From: Lumo Air bookings\nSubject: Booking KV9M1 confirmed\n\nFlight KV 905 Lisbon (LIS) to ' +
      'Amsterdam (AMS) on 24 Oct 2026, departing 17:30 UTC. Booking reference KV9M1.',
  },
];

/**
 * Reference path: list 1, emails 6, tool_catalog 1, contacts 1, calendar 1, sms 1,
 * write 1 = 12 calls.
 */
export const LONG_TASK_TRIP_ORGANIZER: E2EScenario = {
  id: 'long-task-trip-organizer',
  conversationId: 'e2e-long-task-trip',
  contentClass: 'synthetic_public',
  prompt:
    'I fly to Lisbon on 21 October and all my travel emails are in inbox/. Make me a trip sheet at ' +
    'trips/lisbon.md with every booking reference, put my flight there in my calendar, and text ' +
    'Avery Chen what time I land.',
  initialWorkspaceFiles: TRIP_FILES,
  rubrics: [
    ...completedTurnRubrics(0),
    ...fileContains('trips/lisbon.md', ['KV7Q2', 'HTL-55821', 'CAR-30417', 'KV9M1', '14:25']),
    { kind: 'native_fixture_state', path: 'calendar.createdEventCount', expectedValue: '1' },
    {
      kind: 'native_fixture_state',
      path: 'calendar.lastCreatedStartDate',
      expectedValue: '2026-10-21T11:40:00.000Z',
    },
    {
      kind: 'native_fixture_state',
      path: 'calendar.lastCreatedEndDate',
      expectedValue: '2026-10-21T14:25:00.000Z',
    },
    { kind: 'native_fixture_state', path: 'sms.opened', expectedValue: 'true' },
    { kind: 'native_fixture_state', path: 'sms.recipientCount', expectedValue: '1' },
    ...budgetRubrics('long-task-trip-organizer', 12),
  ],
};

// --- Research brief with a superseded fact ---------------------------------

const RESEARCH_NOTES: ReadonlyArray<readonly [id: string, text: string]> = [
  ['N-01', 'Tidewell 12: 12 kWh, 5,400 EUR installed, 8-year warranty.'],
  ['N-02', 'Brightcell 9: 9 kWh, 4,200 EUR installed, 12-year warranty.'],
  ['N-03', 'Kestrel 13: 13.5 kWh, 7,800 EUR installed, 10-year warranty.'],
  [
    'N-04',
    'Hearthcell 10: 10.2 kWh, 6,400 EUR installed (list price, March 2026), 10-year warranty.',
  ],
  ['N-05', 'Installer visit: every price in these notes already includes installation.'],
  ['N-06', 'Reviews: owners praise the Tidewell 12 app; the Kestrel 13 runs quietly.'],
  ['N-07', 'Brightcell 9 units can be stacked: two units give 18 kWh for 8,400 EUR installed.'],
  [
    'N-08',
    'Municipal battery subsidy of 500 EUR: discontinued on 2026-08-31, no new applications.',
  ],
  [
    'N-09',
    'Forum post (unconfirmed, no date): someone expects the Kestrel 13 to drop to 5,900 EUR soon.',
  ],
  ['N-10', 'Tidewell sells a warranty extension to 10 years for 900 EUR.'],
  [
    'N-11',
    'Official Hearthcell price list, 2026-10-02: Hearthcell 10 installed price is now 5,650 EUR.',
  ],
  ['N-12', 'Background: LFP batteries tolerate more charge cycles than NMC batteries.'],
];

/** Reference path: list 1, notes 12, write 1 = 14 calls. */
export const LONG_TASK_RESEARCH_BRIEF: E2EScenario = {
  id: 'long-task-research-brief',
  conversationId: 'e2e-long-task-research',
  contentClass: 'synthetic_public',
  prompt:
    'Using my research notes in notes/, write a short brief at briefs/home-battery.md on which home ' +
    'battery I should buy. It must cost at most 6,000 EUR installed, store at least 10 kWh and come ' +
    'with at least a 10-year warranty. Cite the note ids you rely on and end with the line ' +
    '"Recommendation: <model>".',
  initialWorkspaceFiles: RESEARCH_NOTES.map(([id, text]) => ({
    path: `notes/${id}.md`,
    content: `# ${id}\n\n${text}`,
  })),
  rubrics: [
    ...completedTurnRubrics(0),
    ...fileContains('briefs/home-battery.md', ['Recommendation: Hearthcell 10', 'N-11']),
    ...budgetRubrics('long-task-research-brief', 14),
  ],
};

// --- Resuming an interrupted multi-step job --------------------------------

const RECONCILE_FILES: ReadonlyArray<E2EWorkspaceSeedFile> = [
  {
    path: 'tasks/reconcile-stock.md',
    content: [
      '# Weekly stock reconciliation',
      '1. Add up inventory/warehouse-a.csv and inventory/warehouse-b.csv per SKU into out/combined-stock.csv (sku,on_hand).',
      '2. Write every SKU with on_hand 0 to out/sold-out.txt, one per line.',
      '3. For every SKU whose combined on_hand is below its reorder_point in inventory/reorder-points.csv, add a line sku,order_qty to out/reorder-list.csv, where order_qty = target - on_hand.',
      '4. Write out/summary.md with the line "Units to order: N", where N is the sum of order_qty.',
      'Tick each step in tasks/progress.md as soon as it is done.',
    ].join('\n'),
  },
  {
    path: 'tasks/progress.md',
    content: [
      '- [x] Step 1',
      '- [x] Step 2',
      '- [ ] Step 3 (interrupted: stopped after SKU-104)',
      '- [ ] Step 4',
    ].join('\n'),
  },
  {
    path: 'inventory/warehouse-a.csv',
    content:
      'sku,on_hand\nSKU-101,4\nSKU-102,0\nSKU-103,15\nSKU-104,7\nSKU-105,0\nSKU-106,5\nSKU-107,1\nSKU-108,22',
  },
  {
    path: 'inventory/warehouse-b.csv',
    content:
      'sku,on_hand\nSKU-101,0\nSKU-102,0\nSKU-103,10\nSKU-104,0\nSKU-105,0\nSKU-106,7\nSKU-107,2\nSKU-108,18',
  },
  {
    path: 'inventory/reorder-points.csv',
    content:
      'sku,reorder_point,target\nSKU-101,10,30\nSKU-102,5,20\nSKU-103,10,30\nSKU-104,8,24\n' +
      'SKU-105,6,18\nSKU-106,10,25\nSKU-107,5,15\nSKU-108,10,40',
  },
  {
    path: 'out/combined-stock.csv',
    content:
      'sku,on_hand\nSKU-101,4\nSKU-102,0\nSKU-103,25\nSKU-104,7\nSKU-105,0\nSKU-106,12\nSKU-107,3\nSKU-108,40',
  },
  { path: 'out/sold-out.txt', content: 'SKU-102\nSKU-105' },
  { path: 'out/reorder-list.csv', content: 'sku,order_qty\nSKU-101,26\nSKU-102,20\nSKU-104,17' },
];

/**
 * Reference path: steps 1, progress 1, combined stock 1, reorder points 1, partial list 1,
 * write list 1, write summary 1, write progress 1 = 8 calls (9 with a listing).
 */
export const LONG_TASK_RESUME_INTERRUPTED: E2EScenario = {
  id: 'long-task-resume-interrupted',
  conversationId: 'e2e-long-task-resume',
  contentClass: 'synthetic_public',
  prompt:
    'My weekly stock reconciliation got cut off halfway yesterday. Pick it up where it stopped and ' +
    'finish it. The steps are in tasks/reconcile-stock.md.',
  initialWorkspaceFiles: RECONCILE_FILES,
  rubrics: [
    ...completedTurnRubrics(0),
    ...fileContains('out/reorder-list.csv', ['SKU-101,26', 'SKU-105,18', 'SKU-107,12']),
    { kind: 'workspace_file', path: 'out/reorder-list.csv', excludes: 'SKU-106' },
    { kind: 'workspace_file', path: 'out/summary.md', contains: 'Units to order: 93' },
    { kind: 'workspace_file', path: 'tasks/progress.md', excludes: '[ ]' },
    ...budgetRubrics('long-task-resume-interrupted', 9),
  ],
};

// --- A plan the user changes on the next turn ------------------------------

const VENUES: ReadonlyArray<readonly [slug: string, text: string]> = [
  [
    'harbor-table',
    'Harbor Table. Seats up to 12. Set menu 42 EUR per person: fish or meat, vegetarian on request. No vegan menu.',
  ],
  [
    'casa-brava',
    'Casa Brava. Seats up to 8. Set menu 38 EUR per person, with vegetarian and vegan options.',
  ],
  ['verde-kitchen', 'Verde Kitchen. Seats up to 20. Fully vegan tasting menu, 58 EUR per person.'],
  [
    'lantern-room',
    'Lantern Room. Seats up to 14. Set menu 47 EUR per person, with vegetarian and vegan menus.',
  ],
  [
    'smoke-and-oak',
    'Smoke & Oak. Seats up to 30. Barbecue menu, 45 EUR per person. No vegetarian dishes.',
  ],
];

const DINNER_FILES: ReadonlyArray<E2EWorkspaceSeedFile> = [
  ...VENUES.map(([slug, text]) => ({ path: `venues/${slug}.md`, content: text })),
  {
    path: 'attendees.md',
    content: [
      '# Offsite dinner attendees',
      '- Mira',
      '- Tomas',
      '- Sam (vegetarian)',
      '- Lena',
      '- Kofi',
      '- Ines',
      '- Ravi',
      '- Elif',
    ].join('\n'),
  },
];

const DINNER_REQUEST =
  'I am organising our team offsite dinner on 14 November. Pick the cheapest venue in venues/ that ' +
  'works for everyone in attendees.md within our 50 EUR per person budget, and write the plan to ' +
  'plans/offsite-dinner.md with a "Venue: <name>" line and the cost per person.';

/**
 * Reference path: turn 1 list 1, venues 5, attendees 1, write 1; turn 2 reread 1, write 1
 * = 10 calls.
 */
export const LONG_TASK_PLAN_REVISION: E2EScenario = {
  id: 'long-task-plan-revision',
  conversationId: 'e2e-long-task-dinner',
  contentClass: 'synthetic_public',
  prompt: DINNER_REQUEST,
  userTurns: [
    { content: DINNER_REQUEST },
    {
      content:
        'Two more people are coming: Jordan, who is vegan, and Priya. Please update the plan.',
    },
  ],
  initialWorkspaceFiles: DINNER_FILES,
  rubrics: [
    { kind: 'min_user_turns', min: 2 },
    ...completedTurnRubrics(0),
    ...completedTurnRubrics(1),
    { kind: 'turn_final_response_token', turnIndex: 0, token: 'Casa Brava' },
    ...fileContains('plans/offsite-dinner.md', ['Venue: Lantern Room', '47']),
    { kind: 'workspace_file', path: 'plans/offsite-dinner.md', excludes: 'Venue: Casa Brava' },
    ...budgetRubrics('long-task-plan-revision', 10),
  ],
};

// --- Triage at volume ------------------------------------------------------

const FEEDBACK: ReadonlyArray<readonly [id: string, plan: string, text: string]> = [
  ['fb-01', 'pro', 'I was charged twice for October.'],
  ['fb-02', 'pro', 'The password reset email never arrives.'],
  [
    'fb-03',
    'enterprise',
    'Our invoice lists 40 seats but we only have 25, so finance is holding the payment.',
  ],
  ['fb-04', 'pro', 'The dashboard takes 30 seconds to load.'],
  ['fb-05', 'enterprise', 'Report exports have become very slow this week.'],
  ['fb-06', 'free', 'Please add a dark mode.'],
  ['fb-07', 'pro', 'The new onboarding is fantastic, thank you!'],
  ['fb-08', 'free', 'I was charged in USD instead of EUR this month.'],
  ['fb-09', 'free', 'The mobile app freezes when I scroll a long list.'],
  ['fb-10', 'pro', 'Could you let me export my data to CSV?'],
  ['fb-11', 'enterprise', 'SSO sign-in fails for all of our staff since this morning.'],
  ['fb-12', 'enterprise', 'We would love an audit log of admin actions.'],
  ['fb-13', 'pro', 'My card was declined but the money still left my account.'],
  ['fb-14', 'pro', 'Search results take forever to appear.'],
  ['fb-15', 'free', 'I get signed out every few minutes.'],
  ['fb-16', 'free', 'Support solved my problem in minutes. Great job.'],
  ['fb-17', 'enterprise', 'We were billed for another year after we cancelled the renewal.'],
  ['fb-18', 'pro', 'Please add calendar sync.'],
  ['fb-19', 'pro', 'My two-factor codes are rejected as invalid.'],
  ['fb-20', 'enterprise', 'Your team has been great this quarter.'],
];

const TRIAGE_FILES: ReadonlyArray<E2EWorkspaceSeedFile> = [
  ...FEEDBACK.map(([id, plan, text]) => ({
    path: `feedback/inbox/${id}.txt`,
    content: `id: ${id}\nplan: ${plan}\n\n${text}`,
  })),
  {
    path: 'feedback/taxonomy.md',
    content: [
      '# Feedback themes (each item has exactly one)',
      '- billing: charges, invoices, payments, refunds',
      '- login: signing in, passwords, SSO, two-factor, sessions',
      '- performance: slowness, freezes, timeouts',
      '- feature-request: asks for something the product does not do yet',
      '- praise: positive feedback that reports no problem',
      '',
      'Urgent: a billing or login problem from a customer on the enterprise plan.',
    ].join('\n'),
  },
];

/** Reference path: list 1, taxonomy 1, feedback 20, write 2 = 24 calls. */
export const LONG_TASK_FEEDBACK_TRIAGE: E2EScenario = {
  id: 'long-task-feedback-triage',
  conversationId: 'e2e-long-task-triage',
  contentClass: 'synthetic_public',
  prompt:
    "Triage this week's customer feedback in feedback/inbox/ using feedback/taxonomy.md. Write the " +
    'number of items per theme to feedback/summary.csv as theme,count lines, and list the urgent ' +
    'ones in feedback/urgent.md.',
  initialWorkspaceFiles: TRIAGE_FILES,
  rubrics: [
    ...completedTurnRubrics(0),
    ...fileContains('feedback/summary.csv', [
      'billing,5',
      'login,4',
      'performance,4',
      'feature-request,4',
      'praise,3',
    ]),
    ...fileContains('feedback/urgent.md', ['fb-03', 'fb-11', 'fb-17']),
    { kind: 'workspace_file', path: 'feedback/urgent.md', excludes: 'fb-05' },
    ...budgetRubrics('long-task-feedback-triage', 24),
  ],
};

export const E2E_LONG_TASK_SCENARIOS: ReadonlyArray<E2EScenario> = [
  LONG_TASK_EXPENSE_REPORT,
  LONG_TASK_TRIP_ORGANIZER,
  LONG_TASK_RESEARCH_BRIEF,
  LONG_TASK_RESUME_INTERRUPTED,
  LONG_TASK_PLAN_REVISION,
  LONG_TASK_FEEDBACK_TRIAGE,
];
