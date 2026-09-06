// ---------------------------------------------------------------------------
// Tests — useChatScreenPresentationState follows the active i18n locale for
// temporal marker dates
// ---------------------------------------------------------------------------
// Regression test for a defect where the chat screen's date/day-separator
// markers always used Intl's 'en-US' default (e.g. "Conversation began
// SEPTEMBER 5, 2026" while every other string on screen was in Arabic)
// because computeTemporalMarkers was called with no `locale` option at all.
// The fix threads the resolved app locale through useTranslation() and
// getLocaleBcp47Tag() into computeTemporalMarkers.

import { act, renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import { useChatScreenPresentationState } from '../../../src/screens/chatScreen/useChatScreenPresentationState';
import { createChatDisplayStateCache } from '../../../src/screens/chatScreenDisplayState';
import { i18n } from '../../../src/i18n/manager';
import type { Conversation } from '../../../src/types/conversation';
import type { ActiveConversationExecutionState } from '../../../src/services/agents/activeConversationExecutionState';

const FIRST_MESSAGE_TIMESTAMP = new Date('2026-09-05T09:00:00Z').getTime();
// Kept well under the 30-minute cold-start-cue threshold so that marker
// doesn't also claim the single message's `beforeMessageId` and shadow the
// thread-start marker this test actually cares about.
const FAKE_NOW = FIRST_MESSAGE_TIMESTAMP + 60_000;

function buildConversation(): Conversation {
  return {
    id: 'conversation-1',
    title: 'Test conversation',
    providerId: 'anthropic',
    systemPrompt: '',
    createdAt: FIRST_MESSAGE_TIMESTAMP,
    updatedAt: FIRST_MESSAGE_TIMESTAMP,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'hello',
        timestamp: FIRST_MESSAGE_TIMESTAMP,
      },
    ],
  };
}

const NOOP_EXECUTION_STATE: ActiveConversationExecutionState = {
  canStop: false,
  isBusy: false,
  kind: 'idle',
};

function renderPresentationState(activeConversation: Conversation) {
  return renderHook(() => {
    const displayStateCacheRef = useRef(createChatDisplayStateCache());
    return useChatScreenPresentationState({
      activeConversation,
      activeConversationId: activeConversation.id,
      displayStateCacheRef,
      executionState: NOOP_EXECUTION_STATE,
      liveSubAgentSnapshotsById: new Map(),
      personaCustomList: [],
      personaOverrides: {},
      streamingDrafts: {},
      streamingMessageId: null,
      visibleSourceMessageLimit: 50,
    });
  });
}

describe('useChatScreenPresentationState temporal marker locale', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(FAKE_NOW);
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.setLocale('en');
    });
    jest.useRealTimers();
  });

  it('formats the thread-start divider in English by default', () => {
    const conversation = buildConversation();
    const { result, unmount } = renderPresentationState(conversation);

    const marker = result.current.temporalMarkersByMessageId.get('m1');
    expect(marker?.kind).toBe('thread-start');
    expect(marker?.text).toMatch(/Conversation began/);
    expect(marker?.text).toContain('September');

    unmount();
  });

  it('formats the thread-start divider using the Arabic locale, with no Latin month name, once the app locale is Arabic', async () => {
    await act(async () => {
      await i18n.setLocale('ar');
    });

    const conversation = buildConversation();
    const { result, unmount } = renderPresentationState(conversation);

    const marker = result.current.temporalMarkersByMessageId.get('m1');
    expect(marker?.kind).toBe('thread-start');
    expect(marker?.text).toBeDefined();
    expect(marker?.text).not.toMatch(/Conversation began/);
    // The label itself is already localized ("بدأت المحادثة في ...") — the
    // defect was specifically the embedded {date} falling back to English
    // month names because no locale was passed to Intl.DateTimeFormat.
    expect(marker?.text).not.toMatch(/[A-Za-z]/);

    unmount();
  });
});
