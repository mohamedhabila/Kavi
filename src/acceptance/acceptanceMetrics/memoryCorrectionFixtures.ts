export interface MemoryCorrectionFixture {
  id: string;
  predicate: string;
  previousValue: string;
  userMessage: string;
  proposedValue: string;
  assertionClass:
    | 'current_direct'
    | 'historical'
    | 'hypothetical'
    | 'quoted'
    | 'third_party'
    | 'uncertain';
  shouldReplace: boolean;
}

/** Synthetic, redistributable product fixtures. No upstream benchmark data. */
export const MEMORY_CORRECTION_FIXTURES: ReadonlyArray<MemoryCorrectionFixture> = [
  {
    id: 'current-location-en',
    predicate: 'residence',
    previousValue: 'Amsterdam',
    userMessage: 'I live in Utrecht.',
    proposedValue: 'Utrecht',
    assertionClass: 'current_direct',
    shouldReplace: true,
  },
  {
    id: 'tool-usage-nl',
    predicate: 'tool_usage',
    previousValue: 'Vim',
    userMessage: 'Ik gebruik VS Code.',
    proposedValue: 'VS Code',
    assertionClass: 'current_direct',
    shouldReplace: true,
  },
  {
    id: 'occupation-es',
    predicate: 'occupation',
    previousValue: 'arquitecto',
    userMessage: 'Yo trabajo como ingeniero.',
    proposedValue: 'ingeniero',
    assertionClass: 'current_direct',
    shouldReplace: true,
  },
  {
    id: 'hypothetical-location-control',
    predicate: 'hometown',
    previousValue: 'Cairo',
    userMessage: 'If I grew up in Utrecht, I would cycle more.',
    proposedValue: 'Utrecht',
    assertionClass: 'hypothetical',
    shouldReplace: false,
  },
];
