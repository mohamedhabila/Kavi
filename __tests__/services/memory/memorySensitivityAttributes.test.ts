import { classifyMemoryFactSensitivity } from '../../../src/services/memory/memorySensitivityPolicy';

function classify(attributes: Record<string, unknown>): string {
  return classifyMemoryFactSensitivity({
    declaredSensitivity: 'normal',
    subject: 'project',
    predicate: 'status',
    objectText: 'ready',
    attributes,
  });
}

it('classifies complete nested attribute structure without interpreting labels', () => {
  expect(classify({ auth: { refreshToken: `ghp_${'a'.repeat(36)}` } })).toBe('restricted');
  expect(classify({ note: 'person@example.com' })).toBe('sensitive');
  expect(classify({ auth: { refreshToken: 'opaque' } })).toBe('normal');
  expect(classify({ release: { state: 'ready' } })).toBe('normal');
});

it('does not synthesize a phrase across independent fields', () => {
  expect(classify({ api: 'key' })).toBe('normal');
});

it.each([
  ['depth', { a: { b: { c: { d: { e: 'value' } } } } }],
  [
    'entry count',
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, index])),
  ],
  ['array count', { values: Array.from({ length: 33 }, (_, index) => index) }],
  ['string length', { value: 'x'.repeat(1_001) }],
] as const)('fails closed on %s truncation', (_name, attributes) => {
  expect(classify(attributes)).toBe('restricted');
});

it('fails closed on cyclic attributes', () => {
  const attributes: Record<string, unknown> = {};
  attributes.self = attributes;
  expect(classify(attributes)).toBe('restricted');
});

it.each([null, [], new Date(0)])('fails closed on a malformed runtime root: %s', (attributes) => {
  expect(classify(attributes as unknown as Record<string, unknown>)).toBe('restricted');
});

it('fails closed when attribute enumeration throws', () => {
  const attributes = {} as Record<string, unknown>;
  Object.defineProperty(attributes, 'unsafe', {
    enumerable: true,
    get() {
      throw new Error('attribute getter failed');
    },
  });
  expect(classify(attributes)).toBe('restricted');
});

it('fails closed when a proxy prevents root inspection', () => {
  const attributes = new Proxy<Record<string, unknown>>(
    {},
    {
      getPrototypeOf() {
        throw new Error('attribute prototype failed');
      },
    },
  );
  expect(classify(attributes)).toBe('restricted');
});

it('lets truncation dominate a structurally sensitive value', () => {
  expect(
    classify({
      note: 'person@example.com',
      oversized: 'x'.repeat(1_001),
    }),
  ).toBe('restricted');
});
