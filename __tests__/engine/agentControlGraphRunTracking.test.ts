import { shouldTrackForegroundAgentRun } from '../../src/engine/graph/runTracking';
import type { Message } from '../../src/types/message';

const userMessage = (content: string, attachmentCount = 0): Message => ({
  id: 'user-1',
  role: 'user',
  content,
  timestamp: 1,
  attachments: Array.from({ length: attachmentCount }, (_, index) => ({
    id: `attachment-${index}`,
    name: `attachment-${index}.txt`,
    type: 'file',
    mimeType: 'text/plain',
    uri: `file:///attachment-${index}.txt`,
    size: 1,
  })),
});

describe('agent control graph run tracking', () => {
  it('tracks actionable turns', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage('Create a file and verify it.'),
      }),
    ).toBe(true);
  });

  it('tracks short requests on the normal workflow path', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage('hi'),
      }),
    ).toBe(true);
  });

  it('tracks attachment-only requests', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage('', 1),
      }),
    ).toBe(true);
  });

  it('does not track structurally empty input', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage(''),
      }),
    ).toBe(false);
  });

  it('keeps punctuation-only input on the language-neutral workflow path', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage(' ... '),
      }),
    ).toBe(true);
  });

  it('does not track input that is only Unicode whitespace', () => {
    expect(
      shouldTrackForegroundAgentRun({ latestUserMessage: userMessage('\u2003\u3000\n') }),
    ).toBe(false);
  });

  // Symbols and any script are input: nothing guesses what they mean.
  it.each(['...', '؟،', '…。', '🫶🏽', '∑→∞', '\u0301', '\u200d'])(
    'tracks nonempty symbol or mixed-script input: %s',
    (content) => {
      expect(shouldTrackForegroundAgentRun({ latestUserMessage: userMessage(content) })).toBe(true);
    },
  );

  it('does not create workflow runs for registered slash commands', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage('/new'),
      }),
    ).toBe(false);
  });

  it('keeps unknown slash-prefixed requests on the normal workflow path', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage('/future-command'),
      }),
    ).toBe(true);
  });

  it('tracks run resumes regardless of direct-request assessment', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage(''),
        reuseAgentRunId: 'run-1',
      }),
    ).toBe(true);
  });

  it('tracks standalone literal-token requests on the normal workflow path', () => {
    expect(
      shouldTrackForegroundAgentRun({
        latestUserMessage: userMessage('CHECKNO42'),
      }),
    ).toBe(true);
  });
});
