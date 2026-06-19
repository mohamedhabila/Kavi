import type { AssistantCompletionMetadata } from '../../src/types/message';
import {
  buildIncompleteTextContinuationNote,
  isResumableIncompleteTextCompletion,
  isTokenBudgetExhaustedCompletion,
  shouldResumeIncompleteFinalTextTurn,
} from '../../src/services/llm/support/completionRecovery';

describe('completion recovery', () => {
  it('identifies token budget exhaustion reasons', () => {
    expect(
      isTokenBudgetExhaustedCompletion({
        completionStatus: 'incomplete',
        finishReason: 'length',
      }),
    ).toBe(true);

    expect(
      isTokenBudgetExhaustedCompletion({
        completionStatus: 'incomplete',
        finishReason: 'content_filter',
      }),
    ).toBe(false);
  });

  it('allows resumable incomplete final text for supported reasons', () => {
    const completion: AssistantCompletionMetadata = {
      completionStatus: 'incomplete',
      finishReason: 'length',
    };

    expect(isResumableIncompleteTextCompletion(completion)).toBe(true);
    expect(
      shouldResumeIncompleteFinalTextTurn({
        completion,
        fullContent: 'partial answer',
        recoveryCount: 0,
      }),
    ).toBe(true);
  });

  it('blocks continuation when recovery retries are exhausted', () => {
    expect(
      shouldResumeIncompleteFinalTextTurn({
        completion: {
          completionStatus: 'incomplete',
          finishReason: 'length',
        },
        fullContent: 'partial answer',
        recoveryCount: 2,
      }),
    ).toBe(false);
  });

  it('builds a continuation system note', () => {
    const note = buildIncompleteTextContinuationNote('length');
    expect(note).toContain('[SYSTEM FINAL ANSWER CONTINUE]');
    expect(note).toContain('previous final answer ended early');
    expect(note).toContain('Do not restart from the beginning');
  });
});
