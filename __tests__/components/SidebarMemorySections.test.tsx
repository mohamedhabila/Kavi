// ---------------------------------------------------------------------------
// Tests — Sidebar memory IA sections
// ---------------------------------------------------------------------------

import { act, render, fireEvent } from '@testing-library/react-native';
import {
  TodaysFocusTile,
  OpenThreadsChips,
  PinnedMoments,
  RecallSearchInput,
  MemoryStats,
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
jest.mock('../../src/services/memory/facts/queries', () => ({
  __mockListFacts: jest.fn(() => []),
  __mockCountFacts: jest.fn(() => 0),
  listFacts: (opts: unknown) => {
    const fn = require('../../src/services/memory/facts/queries').__mockListFacts;
    return fn(opts);
  },
  countFacts: () => {
    const fn = require('../../src/services/memory/facts/queries').__mockCountFacts;
    return fn();
  },
}));
jest.mock('../../src/services/memory/episodes/queries', () => ({
  __mockCountEpisodes: jest.fn(() => 0),
  countEpisodes: () => {
    const fn = require('../../src/services/memory/episodes/queries').__mockCountEpisodes;
    return fn();
  },
}));

jest.mock('../../src/services/memory/taskStack', () => ({
  __mockGetActiveTaskTitle: jest.fn(() => null),
  getActiveTaskTitle: (threadId: string) => {
    const fn = require('../../src/services/memory/taskStack').__mockGetActiveTaskTitle;
    return fn(threadId);
  },
}));

jest.mock('../../src/services/memory/workingBlocks', () => ({
  __mockGetWorkingBlock: jest.fn(() => null),
  __mockListRecentWorkingBlocks: jest.fn(() => []),
  getWorkingBlock: (label: string, scope: unknown) => {
    const fn = require('../../src/services/memory/workingBlocks').__mockGetWorkingBlock;
    return fn(label, scope);
  },
  listRecentWorkingBlocks: (label: string, limit: number) => {
    const fn = require('../../src/services/memory/workingBlocks').__mockListRecentWorkingBlocks;
    return fn(label, limit);
  },
}));

let memoryListener:
  | ((event: { scope: 'global' | 'conversation' | 'daily' | 'structured' | 'all'; updatedAt: number }) => void)
  | null = null;

jest.mock('../../src/services/memory/store', () => ({
  __mockSubscribeToMemoryChanges: jest.fn(),
  subscribeToMemoryChanges: (listener: typeof memoryListener) => {
    const fn = require('../../src/services/memory/store').__mockSubscribeToMemoryChanges;
    return fn(listener);
  },
}));

const blocksMock = require('../../src/services/memory/blocks');
const factsMock = require('../../src/services/memory/facts/queries');
const episodesMock = require('../../src/services/memory/episodes/queries');
const taskStackMock = require('../../src/services/memory/taskStack');
const workingBlocksMock = require('../../src/services/memory/workingBlocks');
const memoryStoreMock = require('../../src/services/memory/store');

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'nav.todaysFocus': "Today's focus",
        'nav.todaysFocusEmpty': 'Nothing in focus yet.',
        'nav.openThreads': 'Open threads',
        'nav.openThreadsEmpty': 'No open threads.',
        'nav.pinnedMoments': 'Pinned moments',
        'nav.pinnedMomentsEmpty': 'Pin a fact to surface it here.',
        'nav.recallPlaceholder': 'Recall a moment…',
        'nav.recallSearch': 'Search memory',
        'nav.memoryStats': 'Memory',
        'nav.memoryStatsFacts': '{count} facts',
        'nav.memoryStatsEpisodes': '{count} episodes',
        'nav.memoryStatsActiveTask': 'Active: {task}',
      };
      let text = map[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return text;
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
  memoryListener = null;
  blocksMock.__mockGetBlock.mockReset();
  blocksMock.__mockGetBlock.mockReturnValue(null);
  factsMock.__mockListFacts.mockReset();
  factsMock.__mockListFacts.mockReturnValue([]);
  factsMock.__mockCountFacts.mockReset();
  factsMock.__mockCountFacts.mockReturnValue(0);
  episodesMock.__mockCountEpisodes.mockReset();
  episodesMock.__mockCountEpisodes.mockReturnValue(0);
  taskStackMock.__mockGetActiveTaskTitle.mockReset();
  taskStackMock.__mockGetActiveTaskTitle.mockReturnValue(null);
  workingBlocksMock.__mockListRecentWorkingBlocks.mockReset();
  workingBlocksMock.__mockListRecentWorkingBlocks.mockReturnValue([]);
  workingBlocksMock.__mockGetWorkingBlock.mockReset();
  workingBlocksMock.__mockGetWorkingBlock.mockReturnValue(null);
  memoryStoreMock.__mockSubscribeToMemoryChanges.mockReset();
  memoryStoreMock.__mockSubscribeToMemoryChanges.mockImplementation((listener: typeof memoryListener) => {
    memoryListener = listener;
    return jest.fn();
  });
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

  it('prefers the scoped active focus for the active conversation over unrelated recent focus', () => {
    workingBlocksMock.__mockGetWorkingBlock.mockImplementation((label: string, scope: any) => {
      if (
        label === 'active_focus' &&
        scope?.conversationId === 'conv-side' &&
        scope?.threadId === 'conv-side'
      ) {
        return { content: 'Scoped side-thread focus.' };
      }
      return null;
    });
    workingBlocksMock.__mockListRecentWorkingBlocks.mockReturnValue([
      { content: 'Stale focus from another thread.' },
    ]);

    const { getByTestId } = render(
      <TodaysFocusTile colors={colors} conversationId="conv-side" />,
    );
    expect(getByTestId('sidebar-todays-focus-body').props.children).toBe(
      'Scoped side-thread focus.',
    );
  });

  it('refreshes when structured memory changes', () => {
    workingBlocksMock.__mockListRecentWorkingBlocks.mockReturnValueOnce([]);
    const { getByTestId } = render(<TodaysFocusTile colors={colors} />);
    expect(getByTestId('sidebar-todays-focus-body').props.children).toBe(
      'Nothing in focus yet.',
    );

    workingBlocksMock.__mockListRecentWorkingBlocks.mockReturnValue([
      { content: 'Fresh focus from the completed turn.' },
    ]);
    act(() => {
      memoryListener?.({ scope: 'structured', updatedAt: 100 });
    });

    expect(getByTestId('sidebar-todays-focus-body').props.children).toBe(
      'Fresh focus from the completed turn.',
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

  it('uses scoped open threads for the active conversation instead of unrelated recent blocks', () => {
    workingBlocksMock.__mockGetWorkingBlock.mockImplementation((label: string, scope: any) => {
      if (
        label === 'open_threads' &&
        scope?.conversationId === 'conv-side' &&
        scope?.threadId === 'conv-side'
      ) {
        return { content: '- scoped alpha\n- scoped beta' };
      }
      return null;
    });
    workingBlocksMock.__mockListRecentWorkingBlocks.mockReturnValue([
      { content: '- stale unrelated thread' },
    ]);

    const onSelect = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <OpenThreadsChips colors={colors} conversationId="conv-side" onSelect={onSelect} />,
    );
    expect(queryByTestId('sidebar-open-thread-stale unrelated thread')).toBeNull();
    fireEvent.press(getByTestId('sidebar-open-thread-scoped beta'));
    expect(onSelect).toHaveBeenCalledWith('scoped beta');
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

// ── MemoryStats ─────────────────────────────────────────────────────────────

describe('MemoryStats', () => {
  it('renders fact and episode counts', () => {
    factsMock.__mockCountFacts.mockReturnValue(12);
    episodesMock.__mockCountEpisodes.mockReturnValue(3);

    const { getByTestId } = render(<MemoryStats colors={colors} />);
    expect(getByTestId('sidebar-memory-facts').props.children).toBe('12 facts');
    expect(getByTestId('sidebar-memory-episodes').props.children).toBe('3 episodes');
  });

  it('renders active task when one exists', () => {
    taskStackMock.__mockGetActiveTaskTitle.mockReturnValue('Build API');

    const { getByTestId } = render(
      <MemoryStats colors={colors} conversationId="conv-1" />,
    );
    expect(getByTestId('sidebar-memory-task').props.children).toBe('Active: Build API');
  });

  it('renders consolidation tier label when provided', () => {
    const { getByTestId } = render(
      <MemoryStats
        colors={colors}
        consolidationTierLabel="Active chat provider fallback: Chat Provider"
      />,
    );
    expect(getByTestId('sidebar-memory-consolidation-tier').props.children).toBe(
      'Active chat provider fallback: Chat Provider',
    );
  });

  it('does not render active task line when none exists', () => {
    const { queryByTestId } = render(
      <MemoryStats colors={colors} conversationId="conv-1" />,
    );
    expect(queryByTestId('sidebar-memory-task')).toBeNull();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <MemoryStats colors={colors} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('sidebar-memory-stats'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('refreshes counts when structured memory changes', () => {
    factsMock.__mockCountFacts.mockReturnValueOnce(1).mockReturnValue(5);
    episodesMock.__mockCountEpisodes.mockReturnValueOnce(0).mockReturnValue(2);

    const { getByTestId } = render(<MemoryStats colors={colors} />);
    expect(getByTestId('sidebar-memory-facts').props.children).toBe('1 facts');

    act(() => {
      memoryListener?.({ scope: 'structured', updatedAt: 100 });
    });

    expect(getByTestId('sidebar-memory-facts').props.children).toBe('5 facts');
    expect(getByTestId('sidebar-memory-episodes').props.children).toBe('2 episodes');
  });

  it('survives a read failure by rendering zeros', () => {
    factsMock.__mockCountFacts.mockImplementation(() => {
      throw new Error('db down');
    });
    episodesMock.__mockCountEpisodes.mockImplementation(() => {
      throw new Error('db down');
    });

    const { getByTestId } = render(<MemoryStats colors={colors} />);
    expect(getByTestId('sidebar-memory-facts').props.children).toBe('0 facts');
    expect(getByTestId('sidebar-memory-episodes').props.children).toBe('0 episodes');
  });
});
