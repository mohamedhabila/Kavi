// ---------------------------------------------------------------------------
// Tests — Skills Filter & Frontmatter
// ---------------------------------------------------------------------------

import {
  normalizeSkillFilter,
  normalizeSkillFilterForComparison,
  matchesSkillFilter,
} from '../../src/services/skills/filter';
import {
  parseFrontmatterBlock,
  getFrontmatterString,
  normalizeStringList,
} from '../../src/services/markdown/frontmatter';

describe('normalizeSkillFilter', () => {
  it('returns undefined for undefined', () => {
    expect(normalizeSkillFilter(undefined)).toBeUndefined();
  });

  it('normalizes entries', () => {
    expect(normalizeSkillFilter([' hello ', 42])).toEqual(['hello', '42']);
  });

  it('filters empty entries', () => {
    expect(normalizeSkillFilter(['a', '', '  '])).toEqual(['a']);
  });
});

describe('normalizeSkillFilterForComparison', () => {
  it('deduplicates and sorts', () => {
    expect(normalizeSkillFilterForComparison(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('matchesSkillFilter', () => {
  it('returns true when both undefined', () => {
    expect(matchesSkillFilter(undefined, undefined)).toBe(true);
  });

  it('returns false when one is undefined', () => {
    expect(matchesSkillFilter(['a'], undefined)).toBe(false);
    expect(matchesSkillFilter(undefined, ['a'])).toBe(false);
  });

  it('returns true for same contents', () => {
    expect(matchesSkillFilter(['b', 'a'], ['a', 'b'])).toBe(true);
  });

  it('returns false for different contents', () => {
    expect(matchesSkillFilter(['a'], ['b'])).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(matchesSkillFilter(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('parseFrontmatterBlock', () => {
  it('parses valid frontmatter', () => {
    const input = '---\ntitle: Test\nversion: 1.0\n---\nBody content here.';
    const result = parseFrontmatterBlock(input);
    expect(result.metadata.title).toBe('Test');
    expect(result.metadata.version).toBe(1.0);
    expect(result.content).toBe('Body content here.');
  });

  it('returns empty metadata when no frontmatter', () => {
    const result = parseFrontmatterBlock('Just regular text');
    expect(result.metadata).toEqual({});
    expect(result.content).toBe('Just regular text');
  });

  it('returns empty metadata for unclosed frontmatter', () => {
    const result = parseFrontmatterBlock('---\ntitle: Test\nNo closing');
    expect(result.metadata).toEqual({});
  });

  it('handles empty frontmatter', () => {
    const result = parseFrontmatterBlock('---\n---\nContent');
    expect(result.metadata).toEqual({});
    expect(result.content).toBe('Content');
  });

  it('handles complex YAML', () => {
    const input = '---\ntags:\n  - foo\n  - bar\nenabled: true\n---\nBody';
    const result = parseFrontmatterBlock(input);
    expect(result.metadata.tags).toEqual(['foo', 'bar']);
    expect(result.metadata.enabled).toBe(true);
  });

  it('returns raw YAML string', () => {
    const result = parseFrontmatterBlock('---\nkey: value\n---\nContent');
    expect(result.raw).toBe('key: value');
  });

  it('handles invalid YAML gracefully', () => {
    const result = parseFrontmatterBlock('---\n: invalid yaml [[\n---\nContent');
    expect(result.metadata).toEqual({});
  });
});

describe('getFrontmatterString', () => {
  it('returns string value', () => {
    expect(getFrontmatterString({ key: 'value' }, 'key')).toBe('value');
  });

  it('returns undefined for non-string', () => {
    expect(getFrontmatterString({ key: 42 }, 'key')).toBeUndefined();
  });

  it('returns undefined for empty string after trim', () => {
    expect(getFrontmatterString({ key: '   ' }, 'key')).toBeUndefined();
  });

  it('returns undefined for missing key', () => {
    expect(getFrontmatterString({}, 'key')).toBeUndefined();
  });
});

describe('normalizeStringList', () => {
  it('splits comma-separated string', () => {
    expect(normalizeStringList('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('handles array input', () => {
    expect(normalizeStringList(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('filters non-strings from array', () => {
    expect(normalizeStringList([42, null, 'valid'])).toEqual(['valid']);
  });

  it('returns empty for non-string non-array', () => {
    expect(normalizeStringList(42)).toEqual([]);
    expect(normalizeStringList(null)).toEqual([]);
  });

  it('filters empty strings', () => {
    expect(normalizeStringList('a,,b,')).toEqual(['a', 'b']);
  });
});
