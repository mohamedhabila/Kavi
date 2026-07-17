import {
  classifyMemoryFactSensitivity,
  codeOwnedMemorySensitivityDeclaration,
  providerMemorySensitivityDeclaration,
  requireMemorySensitivityDeclaration,
} from '../../../src/services/memory/memorySensitivityPolicy';

const arbitrarySemanticText = {
  subject: 'ผู้ใช้',
  predicate: 'ความสัมพันธ์ที่กำหนดเอง',
  objectText: 'ค่าที่ไม่ต้องตีความด้วยกฎภาษา',
};

it.each(['normal', 'personal', 'sensitive', 'restricted'] as const)(
  'preserves the provider-declared %s floor for arbitrary scripts',
  (declaredSensitivity) => {
    expect(classifyMemoryFactSensitivity({ declaredSensitivity, ...arbitrarySemanticText })).toBe(
      declaredSensitivity,
    );
  },
);

it.each([undefined, null, '', 'private', 1, {}])(
  'fails closed for a missing or invalid declared floor: %s',
  (declaredSensitivity) => {
    expect(classifyMemoryFactSensitivity({ declaredSensitivity, ...arbitrarySemanticText })).toBe(
      'restricted',
    );
  },
);

it('lets structural detectors raise but never lower a declaration', () => {
  expect(
    classifyMemoryFactSensitivity({
      declaredSensitivity: 'normal',
      predicate: '任意',
      objectText: 'person@example.com',
    }),
  ).toBe('sensitive');
  expect(
    classifyMemoryFactSensitivity({
      declaredSensitivity: 'personal',
      predicate: '任意',
      objectText: 'person@example.com',
    }),
  ).toBe('sensitive');
  expect(
    classifyMemoryFactSensitivity({
      declaredSensitivity: 'sensitive',
      predicate: '任意',
      objectText: 'ordinary value',
    }),
  ).toBe('sensitive');
});

it.each([
  ['password', 'opaque'],
  ['كلمة المرور', 'opaque'],
  ['医療履歴', 'example'],
  ['home address', 'example'],
  ['age', '42'],
])('does not infer sensitivity from a natural-language label: %s', (predicate, objectText) => {
  expect(
    classifyMemoryFactSensitivity({
      declaredSensitivity: 'normal',
      predicate,
      objectText,
    }),
  ).toBe('normal');
});

it('creates exact provider and code-owned declarations', () => {
  expect(providerMemorySensitivityDeclaration('personal')).toEqual({
    version: 1,
    source: 'provider',
    sensitivity: 'personal',
  });
  expect(codeOwnedMemorySensitivityDeclaration()).toEqual({
    version: 1,
    source: 'code_owned',
    sensitivity: 'normal',
  });
});

it.each([
  undefined,
  { version: 1, source: 'provider' },
  { version: 1, source: 'provider', sensitivity: 'private' },
  { version: 1, source: 'provider', sensitivity: 'normal', extra: true },
  { version: 2, source: 'provider', sensitivity: 'normal' },
])('rejects malformed producer declarations: %s', (declaration) => {
  expect(() => requireMemorySensitivityDeclaration(declaration)).toThrow(
    'memory_sensitivity_declaration_invalid',
  );
});
