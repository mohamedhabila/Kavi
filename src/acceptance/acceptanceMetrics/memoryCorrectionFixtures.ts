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
    predicate: 'fixture_location_en',
    previousValue: 'Amsterdam',
    userMessage: 'I moved to Utrecht last week.',
    proposedValue: 'Utrecht',
    assertionClass: 'current_direct',
    shouldReplace: true,
  },
  {
    id: 'preferred-name-nl',
    predicate: 'fixture_name_nl',
    previousValue: 'Mohamed',
    userMessage: 'Noem me voortaan Sam',
    proposedValue: 'Sam',
    assertionClass: 'current_direct',
    shouldReplace: true,
  },
  {
    id: 'preferred-contact-ar',
    predicate: 'fixture_contact_ar',
    previousValue: 'البريد الإلكتروني',
    userMessage: 'أفضل التواصل عبر سيجنال الآن',
    proposedValue: 'سيجنال',
    assertionClass: 'current_direct',
    shouldReplace: true,
  },
  {
    id: 'hypothetical-location-control',
    predicate: 'fixture_location_control',
    previousValue: 'Amsterdam',
    userMessage: 'If I moved to Utrecht, I would cycle more.',
    proposedValue: 'Utrecht',
    assertionClass: 'hypothetical',
    shouldReplace: false,
  },
];
