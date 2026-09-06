import { render } from '@testing-library/react-native';
import { MemoryFactCard } from '../../src/screens/memory/MemoryFactCard';
import type { MemoryFactRow } from '../../src/screens/memory/memoryScreenTypes';
import { hasLoneSurrogate } from '../helpers/graphemeTestFixtures';

const colors = {
  background: '#000',
  surface: '#111',
  surfaceAlt: '#191919',
  border: '#333',
  subtleBorder: '#292929',
  text: '#fff',
  textSecondary: '#aaa',
  primary: '#0f0',
  primarySoft: '#030',
  danger: '#f00',
} as any;

const t = (key: string) => key;

const makeFact = (overrides: Partial<MemoryFactRow> = {}): MemoryFactRow =>
  ({
    id: 'fact-1',
    subject: 'user',
    predicate: 'name',
    value: 'Mo',
    pinned: false,
    confidence: 0.95,
    createdAt: 1000,
    ...overrides,
  }) as MemoryFactRow;

describe('MemoryFactCard — label capitalization grapheme safety', () => {
  it('renders a plain predicate capitalized as before (no regression on the common case)', () => {
    const { getByText } = render(
      <MemoryFactCard
        colors={colors}
        fact={makeFact({ predicate: 'favorite_food' })}
        onCorrect={jest.fn()}
        onForget={jest.fn()}
        onTogglePin={jest.fn()}
        t={t}
      />,
    );

    expect(getByText('Favorite food')).toBeTruthy();
  });

  it('capitalizes a first grapheme that spans multiple UTF-16 code units instead of silently leaving it lowercase', () => {
    // readableLabel used to build the label with `charAt(0).toLocaleUpperCase() +
    // slice(1)`, which only ever touches the FIRST UTF-16 CODE UNIT. For an
    // emoji or a Devanagari/Arabic combining cluster (this repo's usual
    // grapheme-safety fixtures) that code unit has no case mapping at all, so
    // `charAt(0) + slice(1)` reassembles byte-for-byte back to the original
    // string either way — the bug is invisible on those fixtures specifically
    // because reassembly is a mathematical identity whenever the split code
    // unit is casefold-invariant. Deseret is a real cased script living
    // entirely in the supplementary plane (surrogate pairs): its lowercase
    // "𐐨" (U+10428) only case-maps to uppercase "𐐀" (U+10400) when the WHOLE
    // codepoint is considered together. `charAt(0)` grabs just the lone high
    // surrogate, which has no case mapping of its own, so the old code left
    // the letter silently un-capitalized — this is where the bug is actually
    // observable.
    const deseretLowerA = '\u{10428}';
    const deseretUpperA = '\u{10400}';
    const { getByText, queryByText } = render(
      <MemoryFactCard
        colors={colors}
        fact={makeFact({ predicate: `${deseretLowerA}sound` })}
        onCorrect={jest.fn()}
        onForget={jest.fn()}
        onTogglePin={jest.fn()}
        t={t}
      />,
    );

    const label = getByText(new RegExp(`^[${deseretUpperA}${deseretLowerA}]sound$`, 'u'));
    expect(label.props.children).toBe(`${deseretUpperA}sound`);
    expect(queryByText(`${deseretLowerA}sound`)).toBeNull();
    expect(hasLoneSurrogate(String(label.props.children))).toBe(false);
  });
});
