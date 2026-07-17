import { executeMemoryRemember } from '../../src/services/memory/memoryTools';
import { memoryRememberArgs } from './memoryRememberExecution';

export interface TestRememberInput {
  subject: string;
  subjectType?: 'self' | 'person' | 'place' | 'org' | 'project' | 'thing' | 'concept' | 'event';
  predicate: string;
  value: string;
  scope: 'global' | 'project' | 'conversation' | 'session' | 'persona';
  operation?: 'record' | 'replace_current';
  confidence?: number;
  importance?: number;
  pinned?: boolean;
}

export function testRememberArgs(
  input: TestRememberInput,
  context: Parameters<typeof executeMemoryRemember>[1],
) {
  return memoryRememberArgs({
    userMessageId: context.requestEvidence.userMessageId,
    userMessageText: context.requestEvidence.userMessageText,
    subjectRef:
      input.subject === 'user' || input.subjectType === 'self'
        ? { kind: 'self' }
        : { kind: 'named', label: input.subject },
    subjectType: input.subjectType,
    predicate: input.predicate,
    value: input.value,
    scope: input.scope,
    operation: input.operation,
    confidence: input.confidence,
    importance: input.importance,
    pinned: input.pinned,
  });
}

export function rememberOk(
  args: TestRememberInput,
  context: Parameters<typeof executeMemoryRemember>[1],
) {
  const result = executeMemoryRemember(testRememberArgs(args, context), context);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}
