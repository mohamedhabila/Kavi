jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { executeMemoryRemember } from '../../src/engine/tools/builtin-memory';
import { getMemoryDb } from '../../src/services/memory/database';
import {
  buildE2ERubricResultWithMemoryEvidence as buildResultWithMemoryEvidence,
} from '../helpers/e2eRubricResult';
import { memoryRememberExecution } from '../helpers/memoryRememberExecution';

beforeEach(() => {
  resetE2EMemorySandbox();
});

describe('evaluateE2ERubric memory facts', () => {
  it('checks memory_fact from captured SQLite evidence', () => {
    const conversationId = 'conv-memory-fact';
    const rememberResult = JSON.parse(
      executeMemoryRemember(
        {
          subject: 'e2e-entity-i1',
          predicate: 'artifact_token',
          value: 'E2E-MEM-42',
          scope: 'conversation',
          originConversationId: conversationId,
          originThreadId: conversationId,
        },
        memoryRememberExecution({
          memoryConversationId: conversationId,
          sourceThreadId: conversationId,
          userMessageId: 'user-memory-fact',
          userMessageText: 'e2e-entity-i1 artifact_token is E2E-MEM-42.',
        }),
      ),
    );
    expect(rememberResult.ok).toBe(true);
    const result = buildResultWithMemoryEvidence(conversationId);
    resetE2EMemorySandbox();

    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact',
        subject: 'e2e-entity-i1',
        predicate: 'artifact_token',
        value: 'E2E-MEM-42',
        scope: 'conversation',
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact',
        subject: 'wrong-subject',
        predicate: 'artifact_token',
        value: 'E2E-MEM-42',
        scope: 'conversation',
      }),
    ).toMatchObject({ passed: false });
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact',
        subject: 'e2e-entity-i1',
        predicate: 'artifact_token',
        value: 'E2E-MEM-42',
        scope: 'global',
      }),
    ).toMatchObject({ passed: false });
  });

  it('checks memory_fact_absent against the current replacement', () => {
    const conversationId = 'conv-memory-fact-update';
    const oldResult = JSON.parse(
      executeMemoryRemember(
        {
          subject: 'e2e-entity-update',
          predicate: 'artifact_token',
          value: 'E2E-OLD',
          scope: 'conversation',
          originConversationId: conversationId,
          originThreadId: conversationId,
        },
        memoryRememberExecution({
          memoryConversationId: conversationId,
          sourceThreadId: conversationId,
          userMessageId: 'msg-memory-fact-old',
          userMessageText: 'e2e-entity-update artifact_token is E2E-OLD.',
        }),
      ),
    );
    expect(oldResult.ok).toBe(true);
    const newResult = JSON.parse(
      executeMemoryRemember(
        {
          subject: 'e2e-entity-update',
          predicate: 'artifact_token',
          value: 'E2E-NEW',
          scope: 'conversation',
          originConversationId: conversationId,
          originThreadId: conversationId,
        },
        memoryRememberExecution({
          memoryConversationId: conversationId,
          sourceThreadId: conversationId,
          userMessageId: 'msg-memory-fact-update',
          userMessageText: 'e2e-entity-update artifact_token is E2E-NEW.',
        }),
      ),
    );
    expect(newResult.ok).toBe(true);
    const result = buildResultWithMemoryEvidence(conversationId);

    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact_absent',
        subject: 'e2e-entity-update',
        predicate: 'artifact_token',
        value: 'E2E-OLD',
        scope: 'conversation',
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact_absent',
        subject: 'e2e-entity-update',
        predicate: 'artifact_token',
        value: 'E2E-NEW',
        scope: 'conversation',
      }),
    ).toMatchObject({ passed: false });
  });

  it('does not treat an expired persisted fact as current evidence', () => {
    const conversationId = 'conv-memory-expired';
    const rememberResult = JSON.parse(
      executeMemoryRemember(
        {
          subject: 'e2e-expired-subject',
          predicate: 'temporary_code',
          value: 'EXPIRED-CODE',
          scope: 'global',
        },
        memoryRememberExecution({
          memoryConversationId: conversationId,
          sourceThreadId: conversationId,
          userMessageId: 'msg-memory-expired',
          userMessageText: 'e2e-expired-subject temporary_code is EXPIRED-CODE.',
        }),
      ),
    );
    expect(rememberResult.ok).toBe(true);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET expires_at = ? WHERE id = ?',
      rememberResult.fact.validAt + 1,
      rememberResult.fact.id,
    );

    const result = buildResultWithMemoryEvidence(conversationId);
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact',
        subject: 'e2e-expired-subject',
        predicate: 'temporary_code',
        value: 'EXPIRED-CODE',
        scope: 'global',
      }),
    ).toMatchObject({ passed: false });
    expect(
      evaluateE2ERubric(result, {
        kind: 'memory_fact_absent',
        subject: 'e2e-expired-subject',
        predicate: 'temporary_code',
        value: 'EXPIRED-CODE',
        scope: 'global',
      }),
    ).toMatchObject({ passed: true });
  });
});
