import {
  buildAssistantMessageMetadata,
  hasCompleteFinalAssistantMetadata,
  normalizeLegacyAssistantMessages,
} from '../../src/utils/assistantMessageMetadata';
import { Message } from '../../src/types';

const timestamp = 1_700_000_000_000;

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'message-id',
    role: 'assistant',
    content: '',
    timestamp,
    ...overrides,
  };
}

describe('assistantMessageMetadata', () => {
  it('requires explicit metadata for a complete final assistant message', () => {
    const message = makeMessage({
      id: 'assistant-final',
      role: 'assistant',
      content: 'Final answer',
    });

    expect(hasCompleteFinalAssistantMetadata(message)).toBe(false);
    expect(
      hasCompleteFinalAssistantMetadata({
        ...message,
        assistantMetadata: buildAssistantMessageMetadata('final', {
          completionStatus: 'complete',
        }),
      }),
    ).toBe(true);
  });

  it('normalizes legacy assistant turns into explicit intermediate and final metadata', () => {
    const normalized = normalizeLegacyAssistantMessages([
      makeMessage({ id: 'user-1', role: 'user', content: 'Audit the repository' }),
      makeMessage({
        id: 'assistant-tool',
        role: 'assistant',
        content: 'Inspecting the repository now.',
        toolCalls: [
          { id: 'tc-1', name: 'read_file', arguments: '{"path":"README.md"}', status: 'completed' },
        ],
      }),
      makeMessage({
        id: 'assistant-final',
        role: 'assistant',
        content: 'The audit is complete.',
      }),
    ]);

    expect(normalized[1]?.assistantMetadata).toEqual(
      expect.objectContaining({
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'legacy_migration',
      }),
    );
    expect(normalized[2]?.assistantMetadata).toEqual(
      expect.objectContaining({
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'legacy_migration',
      }),
    );
  });
});
