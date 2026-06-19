import { prepareAgentControlGraphRequestContext } from '../../src/engine/graph/requestContext';
import type { Message } from '../../src/types/message';

const msg = (id: string, role: Message['role'], content: string): Message => ({
  id,
  role,
  content,
  timestamp: 1,
});

describe('agent control graph request context', () => {
  it('tracks the workflow owner while preserving the scoped conversation window', () => {
    const messages = [
      msg('u-old', 'user', 'Create old.txt'),
      msg('a-old', 'assistant', ''),
      msg('t-old', 'tool', 'old result'),
      msg('u-current', 'user', 'Create current.txt then verify it'),
      msg('a-current', 'assistant', ''),
      msg('t-current', 'tool', 'current result'),
    ];

    const context = prepareAgentControlGraphRequestContext({
      graphOwnedRun: true,
      memoryScopedMessages: messages,
      workflowScopeUserMessageId: 'u-current',
    });

    expect(context.graphOwnedModelContextMessages.map((message) => message.id)).toEqual([
      'u-old',
      'a-old',
      't-old',
      'u-current',
      'a-current',
      't-current',
    ]);
    expect(context.hasWorkflowScopeAnchor).toBe(true);
    expect(context.lastUserMessageText).toBe('Create current.txt then verify it');
  });

  it('falls back to the latest scoped request when the workflow anchor is unavailable', () => {
    const messages = [
      msg('u-1', 'user', 'Create first.txt'),
      msg('u-2', 'user', 'Create second.txt'),
    ];

    const context = prepareAgentControlGraphRequestContext({
      graphOwnedRun: true,
      memoryScopedMessages: messages,
      workflowScopeUserMessageId: 'missing-user',
    });

    expect(context.missingWorkflowScopeAnchorId).toBe('missing-user');
    expect(context.lastUserMessageText).toBe('Create second.txt');
  });

  it('keeps request context focused on the active user message', () => {
    const context = prepareAgentControlGraphRequestContext({
      graphOwnedRun: true,
      memoryScopedMessages: [msg('u-current', 'user', 'Continue the task')],
      workflowScopeUserMessageId: 'u-current',
    });

    expect(context.lastUserMessageText).toBe('Continue the task');
  });

  it('keeps standalone literal-token requests on the normal workflow path', () => {
    const context = prepareAgentControlGraphRequestContext({
      graphOwnedRun: true,
      memoryScopedMessages: [msg('u-direct', 'user', 'CHECKNO42')],
      workflowScopeUserMessageId: 'u-direct',
    });

    expect(context.requestAssessment.action).toBe('proceed');
    expect(context.lastUserMessageText).toBe('CHECKNO42');
  });
});
