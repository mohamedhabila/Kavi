// ---------------------------------------------------------------------------
// Tests — Sidebar memory IA sections
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import {
  TodaysFocusTile,
  OpenThreadsChips,
  PinnedMoments,
  RecallSearchInput,
  bucketConversationsByTime,
  parseOpenThreads,
} from '../../src/components/sidebar/SidebarMemorySections';

// Mock memory readers used by the components.
jest.mock('../../src/services/memory/blocks', () => ({
  __mockGetBlock: jest.fn(),
  getBlock: (label: string) => {
    const fn = require('../../src/services/memory/blocks').__mockGetBlock;
    return fn(label);
  },
}));
jest.mock('../../src/services/memory/facts', () => ({
  __mockListFacts: jest.fn(() => []),
  listFacts: (opts: unknown) => {
    const fn = require('../../src/services/memory/facts').__mockListFacts;
    return fn(opts);
  },
}));

const blocksMock = require('../../src/services/memory/blocks');
const factsMock = require('../../src/services/memory/facts');

jest.mock('../../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'nav.todaysFocus': "Today's focus",
        'nav.todaysFocusEmpty': 'Nothing in focus yet.',
        'nav.openThreads': 'Open threads',
        'nav.openThreadsEmpty': 'No open threads.',
        'nav.pinnedMoments': 'Pinned moments',
        'nav.pinnedMomentsEmpty': 'Pin a fact to surface it here.',
        'nav.recallPlaceholder': 'Recall a moment…',
        'nav.recallSearch': 'Search memory',
      };
      return map[key] ?? key;
    },
  }),
}));

const colors = {
  mode: 'dark',
  background: '#000',
  surface: '#111',
  panel: '#111',
  border: '#333',
  text: '#fff',
  textSecondary: '#aaa',
  textTertiary: '#777',
  primary: '#0f0',
  onPrimary: '#fff',
  primarySoft: '#030',
} as any;

beforeEach(() => {
  blocksMock.__mockGetBlock.mockReset();
  blocksMock.__mockGetBlock.mockReturnValue(null);
  factsMock.__mockListFacts.mockReset();
  factsMock.__mockListFacts.mockReturnValue([]);
});

// ── parseOpenThreads ────────────────────────────────────────────────────────

describe('parseOpenThreads', () => {
  it('returns empty array for null/empty content', () => {
    expect(parseOpenThreads(null)).toEqual([]);
    expect(parseOpenThreads('')).toEqual([]);
    expect(parseOpenThreads('   ')).toEqual([]);
  });

  it('splits on newlines and strips bullet/markup prefixes', () => {
    const out = parseOpenThreads('- thread one\n* thread two\n• thread three\n   thread four');
    expect(out).toEqual(['thread one', 'thread two', 'thread three', 'thread four']);
  });

  it('caps to 12 chips', () => {
    const long = Array.from({ length: 25 }, (_, i) => `t${i}`).join('\n');
    expect(parseOpenThreads(long)).toHaveLength(12);
  });

  it('drops blank lines', () => {
    expect(parseOpenThreads('a\n\n\nb\n  \nc')).toEqual(['a', 'b', 'c']);
  });
});

// ── bucketConversationsByTime ───────────────────────────────────────────────

describe('bucketConversationsByTime', () => {
  it('partitions by Today / Yesterday / This week / Earlier', () => {
    const now = new Date('2026-04-29T12:00:00Z').getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const conversations = [
      { id: 'today', updatedAt: now } as any,
      { id: 'yesterday', updatedAt: now - dayMs - 60_000 } as any,
      { id: 'thisWeek', updatedAt: now - 4 * dayMs } as any,
      { id: 'earlier', updatedAt: now - 30 * dayMs } as any,
    ];
    const buckets = bucketConversationsByTime(conversations, now);
    expect(buckets.today.map((c) => c.id)).toEqual(['today']);
    expect(buckets.yesterday.map((c) => c.id)).toEqual(['yesterday']);
    expect(buckets.thisWeek.map((c) => c.id)).toEqual(['thisWeek']);
    expect(buckets.earlier.map((c) => c.id)).toEqual(['earlier']);
  });

  it('falls back to createdAt when updatedAt is missing', () => {
    const now = new Date('2026-04-29T12:00:00Z').getTime();
    const buckets = bucketConversationsByTime(
      [{ id: 'x', createdAt: now } as any],
      now,
    );
    expect(buckets.today.map((c) => c.id)).toEqual(['x']);
  });

  it('returns all empty arrays for empty input', () => {
    const buckets = bucketConversationsByTime([], 0);
    expect(buckets).toEqual({ today: [], yesterday: [], thisWeek: [], earlier: [] });
  });
});

// ── TodaysFocusTile ─────────────────────────────────────────────────────────

describe('TodaysFocusTile', () => {
  it('shows the empty hint when no active_focus block exists', () => {
    const { getByTestId } = render(<TodaysFocusTile colors={colors} />);
    expect(getByTestId('sidebar-todays-focus-body').props.children).toBe(
      'Nothing in focus yet.',
    );
  });

  it('renders the active_focus content', () => {
    blocksMock.__mockGetBlock.mockReturnValue({
      label: 'active_focus',
      content: 'Ship Chunk L tonight.',
    });
    const { getByTestId } = render(<TodaysFocusTile colors={colors} />);
    expect(getByTestId('sidebar-todays-focus-body').props.children).toBe(
      'Ship Chunk L tonight.',
    );
  });

  it('invokes onPress when there is focus content', () => {
    blocksMock.__mockGetBlock.mockReturnValue({ content: 'Focus' });
    const onPress = jest.fn();
    const { getByTestId } = render(
      <TodaysFocusTile colors={colors} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('sidebar-todays-focus'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onPress when the focus block is empty (disabled)', () => {
    blocksMock.__mockGetBlock.mockReturnValue(null);
    const onPress = jest.fn();
    const { getByTestId } = render(
      <TodaysFocusTile colors={colors} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('sidebar-todays-focus'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('survives a memory read failure by rendering the empty state', () => {
    blocksMock.__mockGetBlock.mockImplementation(() => {
      throw new Error('boom');
    });
    const { getByTestId } = render(<TodaysFocusTile colors={colors} />);
    expect(getByTestId('sidebar-todays-focus-body').props.children).toBe(
      'Nothing in focus yet.',
    );
  });
});

// ── OpenThreadsChips ────────────────────────────────────────────────────────

describe('OpenThreadsChips', () => {
  it('shows empty hint when block is missing', () => {
    const { getByTestId } = render(<OpenThreadsChips colors={colors} />);
    expect(getByTestId('sidebar-open-threads-empty')).toBeTruthy();
  });

  it('renders one chip per parsed line and forwards selection', () => {
    blocksMock.__mockGetBlock.mockReturnValue({
      content: '- alpha\n- beta\n- gamma',
    });
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <OpenThreadsChips colors={colors} onSelect={onSelect} />,
    );
    fireEvent.press(getByTestId('sidebar-open-thread-beta'));
    expect(onSelect).toHaveBeenCalledWith('beta');
  });
});

// ── PinnedMoments ───────────────────────────────────────────────────────────

describe('PinnedMoments', () => {
  it('shows empty hint when no pinned facts exist', () => {
    const { getByTestId } = render(<PinnedMoments colors={colors} />);
    expect(getByTestId('sidebar-pinned-moments-empty')).toBeTruthy();
  });

  it('renders pinned facts and forwards selection', () => {
    factsMock.__mockListFacts.mockReturnValue([
      { id: 'f1', predicate: 'wants', objectText: 'a beach trip' },
      { id: 'f2', predicate: 'works at', objectText: 'Acme' },
    ]);
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <PinnedMoments colors={colors} onSelect={onSelect} />,
    );
    fireEvent.press(getByTestId('sidebar-pinned-moment-f1'));
    expect(onSelect).toHaveBeenCalledWith('f1');
    expect(getByTestId('sidebar-pinned-moment-f2')).toBeTruthy();
  });

  it('passes the limit option through to listFacts', () => {
    render(<PinnedMoments colors={colors} limit={3} />);
    expect(factsMock.__mockListFacts).toHaveBeenCalledWith({ pinnedOnly: true, limit: 3 });
  });

  it('survives a fact read failure by rendering empty', () => {
    factsMock.__mockListFacts.mockImplementation(() => {
      throw new Error('db down');
    });
    const { getByTestId } = render(<PinnedMoments colors={colors} />);
    expect(getByTestId('sidebar-pinned-moments-empty')).toBeTruthy();
  });
});

// ── RecallSearchInput ───────────────────────────────────────────────────────

describe('RecallSearchInput', () => {
  it('submits the trimmed query and clears the input', () => {
    const onSubmit = jest.fn();
    const { getByTestId } = render(
      <RecallSearchInput colors={colors} onSubmit={onSubmit} />,
    );
    const input = getByTestId('sidebar-recall-input');
    fireEvent.changeText(input, '  beach trip  ');
    fireEvent(input, 'submitEditing');
    expect(onSubmit).toHaveBeenCalledWith('beach trip');
  });

  it('does not call onSubmit when the input is blank', () => {
    const onSubmit = jest.fn();
    const { getByTestId } = render(
      <RecallSearchInput colors={colors} onSubmit={onSubmit} />,
    );
    const input = getByTestId('sidebar-recall-input');
    fireEvent.changeText(input, '   ');
    fireEvent(input, 'submitEditing');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
