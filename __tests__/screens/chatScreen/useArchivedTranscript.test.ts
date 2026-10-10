jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { act, renderHook } from '@testing-library/react-native';
import { useArchivedTranscript } from '../../../src/screens/chatScreen/useArchivedTranscript';
import { closeTranscriptArchiveDb } from '../../../src/services/transcriptArchive/database';
import {
  _resetTranscriptArchiveStateForTests,
  drainPendingTranscriptArchive,
  noteEvictedMessages,
} from '../../../src/services/transcriptArchive/transcriptArchive';
import { mergeChronologically } from '../../../src/utils/messageChronology';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function message(index: number): Message {
  return {
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    timestamp: 1_000 + index,
  } as Message;
}

function archive(indices: number[]): void {
  noteEvictedMessages('c1', indices.map(message));
  drainPendingTranscriptArchive();
}

beforeEach(() => {
  closeTranscriptArchiveDb();
  expoSqlite.__resetExpoSqliteForTests();
  _resetTranscriptArchiveStateForTests();
});

describe('useArchivedTranscript', () => {
  it('pages older history in, oldest first, as the person scrolls back', () => {
    archive(Array.from({ length: 50 }, (_unused, index) => index + 1));
    const inMemory = [message(0), message(60)];
    const { result } = renderHook(() => useArchivedTranscript('c1', inMemory));

    expect(result.current.remainingCount).toBe(50);
    act(() => result.current.loadEarlier());

    expect(result.current.messages).toHaveLength(40);
    expect(result.current.messages[0]?.id).toBe('m-11');
    expect(result.current.messages.at(-1)?.id).toBe('m-50');
    expect(result.current.remainingCount).toBe(10);

    act(() => result.current.loadEarlier());
    expect(result.current.messages[0]?.id).toBe('m-1');
    expect(result.current.remainingCount).toBe(0);
  });

  it('never shows a message twice when it is still held in memory', () => {
    archive([1, 2, 3]);
    const inMemory = [message(0), message(3)];
    const { result } = renderHook(() => useArchivedTranscript('c1', inMemory));

    expect(result.current.remainingCount).toBe(2);
    act(() => result.current.loadEarlier());
    expect(result.current.messages.map((entry) => entry.id)).toEqual(['m-1', 'm-2']);
  });

  it('counts history archived while the conversation is open', () => {
    const { result } = renderHook(() => useArchivedTranscript('c1', [message(0)]));
    expect(result.current.remainingCount).toBe(0);

    act(() => archive([1, 2]));

    expect(result.current.remainingCount).toBe(2);
  });

  it('starts over for another conversation', () => {
    archive([1, 2]);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useArchivedTranscript(id, []),
      { initialProps: { id: 'c1' as string | null } },
    );
    act(() => result.current.loadEarlier());
    expect(result.current.messages).toHaveLength(2);

    rerender({ id: 'c2' });

    expect(result.current.messages).toEqual([]);
    expect(result.current.remainingCount).toBe(0);
  });
});

describe('mergeChronologically', () => {
  it('interleaves the first kept message ahead of archived history', () => {
    const merged = mergeChronologically([message(1), message(2)], [message(0), message(3)]);

    expect(merged.map((entry) => entry.id)).toEqual(['m-0', 'm-1', 'm-2', 'm-3']);
  });
});
