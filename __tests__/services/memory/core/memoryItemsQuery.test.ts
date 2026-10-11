import {
  buildMemoryMatchExpression,
  memorySearchTerms,
} from '../../../../src/services/memory/core/memoryItemsQuery';

describe('memory search query', () => {
  it('uses whole words for scripts written with spaces, in any language', () => {
    expect(memorySearchTerms('Where does Sara live?')).toEqual(['where', 'does', 'sara', 'live']);
    expect(memorySearchTerms('متى أفضل وقت؟')).toEqual(['أفضل', 'متى', 'وقت']);
  });

  it('cuts scripts written without spaces into trigrams', () => {
    expect(memorySearchTerms('咖啡店在哪里')).toEqual(['咖啡店', '啡店在', '店在哪', '在哪里']);
  });

  it('drops terms the trigram index cannot match', () => {
    expect(memorySearchTerms('a to be')).toEqual([]);
    expect(buildMemoryMatchExpression('to be')).toBeNull();
  });

  it('quotes terms so user text cannot change the query', () => {
    expect(buildMemoryMatchExpression('code "NEAR" OR x')).toBe('"code" OR "near"');
  });

  it('caps the number of terms, keeping the longest', () => {
    const words = Array.from({ length: 40 }, (_, index) => `word${String(index).padStart(2, '0')}`);
    expect(memorySearchTerms(['longerword', ...words].join(' '))).toHaveLength(32);
    expect(memorySearchTerms(['longerword', ...words].join(' '))[0]).toBe('longerword');
  });
});
