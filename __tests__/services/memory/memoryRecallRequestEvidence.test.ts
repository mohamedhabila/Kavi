jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeBuiltinMemoryTool } from '../../../src/engine/tools/toolBuiltinMemoryExecution';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  issueExplicitMemoryRecallGrant,
  resetExplicitMemoryRecallGrantStateForTests,
} from '../../../src/services/memory/explicitMemoryRecallGrant';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import { MEMORY_FACT_SENSITIVITY_POLICY_VERSION } from '../../../src/services/memory/memorySensitivityPolicy';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

// A sensitive fact appears only for what the person asks for in their current message.
// Live, a model asked for one with the evidence object flattened into the top-level
// arguments and a relation phrase that was not in the message: the call was refused as
// "unsupported arguments", the retries silently returned no facts, and the assistant told
// the person nothing was stored. The product now owns the message, its id and the subject,
// asks only for the words that request the relation, and says when it withheld something.

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const MESSAGE = 'Verify the stored access_code for subject `longmem-entity`.';
let callSequence = 0;

function recordSensitiveFact(subject: string, predicate: string, value: string): void {
  const entity = upsertEntity({ name: subject, type: 'thing', now: 50 });
  const { fact } = recordFactWithApplicability(
    { subjectId: entity.id, predicate, objectText: value, scope: 'global', now: 100 },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  getMemoryDb().runSync(
    `UPDATE memory_facts SET sensitivity = 'sensitive', sensitivity_policy_version = ? WHERE id = ?`,
    MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    fact.id,
  );
}

async function recall(args: Record<string, unknown>, message = MESSAGE) {
  callSequence += 1;
  const outcome = await executeBuiltinMemoryTool({
    name: 'memory_recall',
    args,
    conversationId: 'thread-1',
    workspaceConversationId: 'thread-1',
    conversationFileContext: {} as never,
    context: {
      memoryConversationId: 'conversation-1',
      controlGraphGoals: [],
      currentUserMessage: { id: 'user-message-1', text: message },
      executionRunId: 'execution-run-1',
      toolCallId: `tool-call-${callSequence}`,
    },
  });
  return JSON.parse(outcome!.content) as {
    ok: boolean;
    error?: string;
    facts?: Array<{ value: string }>;
    withheldSensitiveFacts?: { count: number; reason: string };
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  resetExplicitMemoryRecallGrantStateForTests();
  ensureFactSchema();
  recordSensitiveFact('longmem-entity', 'access_code', 'LONGMEM-E2E-42');
});

afterEach(() => {
  closeMemoryDb();
});

describe('asking for a sensitive fact', () => {
  it('says why the live flattened request was not enough instead of reporting nothing', async () => {
    const result = await recall({
      subject: 'longmem-entity',
      subject_quote: 'longmem-entity',
      predicate: 'access_code',
      relation_quote: 'has access_code',
      evidence_quote: MESSAGE,
      source_message_id: 'user-message-1',
      version: '1',
    });

    expect(result.ok).toBe(true);
    expect(result.facts).toEqual([]);
    expect(result.withheldSensitiveFacts).toMatchObject({
      count: 1,
      reason: 'relation_quote_not_in_message',
    });
  });

  it('shows the fact when the relation is quoted from the message', async () => {
    const result = await recall({
      subject: 'longmem-entity',
      predicate: 'access_code',
      relation_quote: 'access_code',
    });

    expect(result.facts?.map((fact) => fact.value)).toEqual(['LONGMEM-E2E-42']);
    expect(result.withheldSensitiveFacts).toBeUndefined();
  });

  it('tells a plain recall that sensitive facts were withheld and why', async () => {
    const result = await recall({ subject: 'longmem-entity', predicate: 'access_code' });

    expect(result.facts).toEqual([]);
    expect(result.withheldSensitiveFacts).toMatchObject({ count: 1, reason: 'request_missing' });
  });

  it('still refuses a subject the message does not name', async () => {
    const result = await recall(
      { subject: 'longmem-entity', predicate: 'access_code', relation_quote: 'access_code' },
      'Show my access_code please.',
    );

    expect(result.facts).toEqual([]);
    expect(result.withheldSensitiveFacts?.reason).toBe('subject_not_in_message');
  });

  it('names the arguments it does not understand', async () => {
    const result = await recall({ subject: 'longmem-entity', target: 'x' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('memory_recall received unsupported arguments: target.');
  });
});

describe('issueExplicitMemoryRecallGrant', () => {
  const identity = {
    currentUserMessageId: 'user-message-2',
    executionRunId: 'execution-run-2',
    toolCallId: 'tool-call-grant',
    agentRunId: null,
    scope: resolveLocalMemoryAccessScope({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      personaId: 'default',
      taskId: null,
    }),
  };

  it('needs no subject quote when the person asks about themselves, in any language', () => {
    const issued = issueExplicitMemoryRecallGrant({
      ...identity,
      currentUserMessageText: '请显示我保存的健康资料',
      relationQuote: '健康资料',
      requestedSubject: 'user',
      requestedPredicate: 'health_record',
    });

    expect(issued).toHaveProperty('grant');
  });

  it.each([
    ['subject_missing', { requestedSubject: '' }],
    ['predicate_missing', { requestedPredicate: undefined }],
    ['relation_quote_missing', { relationQuote: ' padded ' }],
    ['relation_quote_not_in_message', { relationQuote: 'blood type' }],
  ])('reports %s', (failure, override) => {
    expect(
      issueExplicitMemoryRecallGrant({
        ...identity,
        currentUserMessageText: '请显示我保存的健康资料',
        relationQuote: '健康资料',
        requestedSubject: 'user',
        requestedPredicate: 'health_record',
        ...override,
      }),
    ).toEqual({ failure });
  });

  it('reports a typed evidence object that does not match its contract', () => {
    expect(
      issueExplicitMemoryRecallGrant({
        ...identity,
        currentUserMessageText: 'Show my health record',
        explicitRequestEvidence: { version: '1' },
      }),
    ).toEqual({ failure: 'evidence_malformed' });
  });
});
