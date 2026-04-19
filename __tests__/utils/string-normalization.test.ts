// ---------------------------------------------------------------------------
// Tests — String Normalization
// ---------------------------------------------------------------------------

import { normalizeStringEntries } from '../../src/utils/string-normalization';

describe('normalizeStringEntries', () => {
  it('returns empty for undefined', () => {
    expect(normalizeStringEntries(undefined)).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(normalizeStringEntries([])).toEqual([]);
  });

  it('trims and converts to string', () => {
    expect(normalizeStringEntries([' hello ', 42, true])).toEqual(['hello', '42', 'true']);
  });

  it('filters empty strings after trim', () => {
    expect(normalizeStringEntries(['  ', '', 'valid'])).toEqual(['valid']);
  });
});
