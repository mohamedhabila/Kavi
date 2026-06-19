import {
  readJsonFieldAtPath,
  structuralValuesMatch,
} from '../../../src/engine/goals/structuralCriterionValues';

describe('readJsonFieldAtPath', () => {
  it('reads nested object paths', () => {
    expect(readJsonFieldAtPath({ allowsModifications: true }, 'allowsModifications')).toBe(true);
  });

  it('reads indexed array paths', () => {
    const payload = [{ allowsModifications: true }];
    expect(readJsonFieldAtPath(payload, '0.allowsModifications')).toBe(true);
  });

  it('falls back to the first array element for unindexed field paths', () => {
    const payload = [{ allowsModifications: true }];
    expect(readJsonFieldAtPath(payload, 'allowsModifications')).toBe(true);
  });
});

describe('structuralValuesMatch', () => {
  it('matches booleans and numbers as strings', () => {
    expect(structuralValuesMatch(true, 'true')).toBe(true);
    expect(structuralValuesMatch(42, '42')).toBe(true);
  });
});