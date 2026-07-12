jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  createExplicitMemoryRecallGrant,
  deriveExplicitMemoryRecallTarget,
  type ExplicitMemoryRecallGrant,
} from '../../../src/services/memory/explicitMemoryRecallGrant';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import {
  executeMemoryRecall,
  type MemoryRecallExecutionContext,
} from '../../../src/services/memory/memoryTools';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const BASE_EXECUTION = {
  memoryConversationId: 'sensitivity-root',
  sourceThreadId: 'sensitivity-thread',
  personaId: 'default',
  taskId: 'sensitivity-task',
  now: 1_000,
} as const;
const REQUEST_IDENTITY = {
  currentUserMessageId: 'user-message-sensitive-1',
  currentUserMessageText: 'What is my medical_status?',
  executionRunId: 'execution-sensitive-1',
  agentRunId: 'agent-sensitive-1',
} as const;

function explicitExecution(
  overrides: Partial<MemoryRecallExecutionContext> = {},
): MemoryRecallExecutionContext {
  const execution = { ...BASE_EXECUTION, ...overrides };
  const requestIdentity = overrides.requestIdentity ?? REQUEST_IDENTITY;
  const explicitUserRequestGrant = createExplicitMemoryRecallGrant({
    ...requestIdentity,
    scope: resolveLocalMemoryAccessScope({
      memoryConversationId: execution.memoryConversationId,
      sourceThreadId: execution.sourceThreadId,
      personaId: execution.personaId,
      taskId: execution.taskId,
    }),
  });
  if (!explicitUserRequestGrant) throw new Error('expected exact explicit recall grant');
  return { ...execution, requestIdentity, explicitUserRequestGrant };
}

function factValues(result: ReturnType<typeof executeMemoryRecall>): string[] {
  return result.ok ? result.facts.map((fact) => fact.value) : [];
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  const subject = upsertEntity({ name: 'user', type: 'self', now: 50 });
  recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'favorite_color',
      objectText: 'green',
      scope: 'global',
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'medical_status',
      objectText: 'sensitive medical value',
      scope: 'global',
      now: 101,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'medical_information',
      objectText: 'sensitive medical information',
      scope: 'global',
      now: 102,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'vault_secret',
      objectText: 'restricted value',
      scope: 'global',
      now: 103,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  const project = upsertEntity({ name: 'project_alpha', type: 'project', now: 50 });
  recordFactWithApplicability(
    {
      subjectId: project.id,
      predicate: 'emergency_contact',
      objectText: 'sensitive project value',
      scope: 'global',
      now: 104,
    },
    { factClass: 'objective', sourceAuthority: 'grounded_user' },
  );
  const alice = upsertEntity({ name: 'alice', type: 'person', now: 50 });
  recordFactWithApplicability(
    {
      subjectId: alice.id,
      predicate: 'contact_details',
      objectText: 'sensitive contact details',
      scope: 'global',
      now: 105,
    },
    { factClass: 'objective', sourceAuthority: 'grounded_user' },
  );
  const oconnor = upsertEntity({ name: 'O’Connor', type: 'person', now: 50 });
  recordFactWithApplicability(
    {
      subjectId: oconnor.id,
      predicate: 'contact_details',
      objectText: 'sensitive O’Connor contact details',
      scope: 'global',
      now: 106,
    },
    { factClass: 'objective', sourceAuthority: 'grounded_user' },
  );
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('agent-facing sensitive recall boundary', () => {
  it('defaults ordinary provider recall to automatic-prompt visibility', () => {
    expect(
      factValues(
        executeMemoryRecall({ subject: 'user', predicate: 'medical_status' }, BASE_EXECUTION),
      ),
    ).toEqual([]);
    expect(
      factValues(
        executeMemoryRecall({ subject: 'user', predicate: 'favorite_color' }, BASE_EXECUTION),
      ),
    ).toEqual(['green']);
  });

  it('exposes only the exact sensitive predicate explicitly requested by the current user', () => {
    const result = executeMemoryRecall(
      { subject: 'user', predicate: 'medical_status' },
      explicitExecution(),
    );

    expect(factValues(result)).toEqual(['sensitive medical value']);
  });

  it.each([
    "What's my medical status?",
    'What\u2019s my medical status?',
    "What's my medical-status?",
  ])('binds separator-only predicate variants for %s', (currentUserMessageText) => {
    const requestIdentity = {
      ...REQUEST_IDENTITY,
      currentUserMessageId: `user-message-${currentUserMessageText.charCodeAt(4)}`,
      currentUserMessageText,
    };
    const result = executeMemoryRecall(
      { subject: 'user', predicate: 'medical_status' },
      explicitExecution({ requestIdentity }),
    );

    expect(factValues(result)).toEqual(['sensitive medical value']);
  });

  it('binds separator-only variants in both named subject and predicate labels', () => {
    const requestIdentity = {
      ...REQUEST_IDENTITY,
      currentUserMessageId: 'user-message-project-alpha',
      currentUserMessageText: "What's project alpha's emergency contact?",
    };
    const result = executeMemoryRecall(
      { subject: 'project_alpha', predicate: 'emergency_contact' },
      explicitExecution({ requestIdentity }),
    );

    expect(factValues(result)).toEqual(['sensitive project value']);
  });

  it.each([
    "What's my Medical Information?",
    "What's my \uff4d\uff45\uff44\uff49\uff43\uff41\uff4c \uff49\uff4e\uff46\uff4f\uff52\uff4d\uff41\uff54\uff49\uff4f\uff4e?",
  ])('binds case and NFKC variants to medical_information for %s', (currentUserMessageText) => {
    const requestIdentity = {
      ...REQUEST_IDENTITY,
      currentUserMessageId: `user-message-medical-${currentUserMessageText.length}`,
      currentUserMessageText,
    };
    const result = executeMemoryRecall(
      { subject: 'user', predicate: 'MEDICAL_INFORMATION' },
      explicitExecution({ requestIdentity }),
    );

    expect(factValues(result)).toEqual(['sensitive medical information']);
  });

  it('binds Alice/alice and predicate case for the exact contact_details request', () => {
    const requestIdentity = {
      ...REQUEST_IDENTITY,
      currentUserMessageId: 'user-message-alice-contact',
      currentUserMessageText: "What's Alice's contact details?",
    };
    const result = executeMemoryRecall(
      { subject: 'alice', predicate: 'CONTACT_DETAILS' },
      explicitExecution({ requestIdentity }),
    );

    expect(factValues(result)).toEqual(['sensitive contact details']);
  });

  it('binds an exact apostrophized subject without broadening the predicate', () => {
    const requestIdentity = {
      ...REQUEST_IDENTITY,
      currentUserMessageId: 'user-message-oconnor-contact',
      currentUserMessageText: "What's O’Connor's contact details?",
    };
    const result = executeMemoryRecall(
      { subject: 'o’connor', predicate: 'contact_details' },
      explicitExecution({ requestIdentity }),
    );

    expect(factValues(result)).toEqual(['sensitive O’Connor contact details']);
  });

  it.each([
    ['near synonym', "What's my health information?", 'medical_information'],
    ['non-separator punctuation', "What's my medical/information?", 'medical_information'],
  ] as const)(
    'does not expand a natural label through %s',
    (_label, currentUserMessageText, predicate) => {
      const requestIdentity = {
        ...REQUEST_IDENTITY,
        currentUserMessageId: `user-message-negative-${predicate}`,
        currentUserMessageText,
      };
      const result = executeMemoryRecall(
        { subject: 'user', predicate },
        explicitExecution({ requestIdentity }),
      );

      expect(factValues(result)).toEqual([]);
    },
  );

  it.each([
    ['all=true', { all: true }],
    ['missing predicate', { subject: 'user' }],
    ['different predicate', { subject: 'user', predicate: 'favorite_color' }],
    ['different subject', { subject: 'someone-else', predicate: 'medical_status' }],
  ] as const)('does not broaden an exact grant through %s', (_label, args) => {
    const result = executeMemoryRecall(args, explicitExecution());

    expect(factValues(result)).not.toContain('sensitive medical value');
    expect(factValues(result)).not.toContain('restricted value');
  });

  it.each([
    [
      'message id',
      { requestIdentity: { ...REQUEST_IDENTITY, currentUserMessageId: 'user-message-other' } },
    ],
    [
      'message text',
      {
        requestIdentity: {
          ...REQUEST_IDENTITY,
          currentUserMessageText: 'What is my other_status?',
        },
      },
    ],
    [
      'execution run',
      { requestIdentity: { ...REQUEST_IDENTITY, executionRunId: 'execution-sensitive-other' } },
    ],
    [
      'agent run',
      { requestIdentity: { ...REQUEST_IDENTITY, agentRunId: 'agent-sensitive-other' } },
    ],
  ] as const)('rejects a grant with mismatched %s identity', (_label, mismatch) => {
    const granted = explicitExecution();
    const result = executeMemoryRecall(
      { subject: 'user', predicate: 'medical_status' },
      { ...granted, ...mismatch },
    );

    expect(factValues(result)).toEqual([]);
  });

  it.each([
    ['conversation', { memoryConversationId: 'sensitivity-root-other' }],
    ['thread', { sourceThreadId: 'sensitivity-thread-other' }],
    ['persona', { personaId: 'sensitivity-persona-other' }],
    ['task', { taskId: 'sensitivity-task-other' }],
  ] as const)('rejects replay in the wrong %s scope', (_label, scopeOverride) => {
    const granted = explicitExecution();
    const result = executeMemoryRecall(
      { subject: 'user', predicate: 'medical_status' },
      { ...granted, ...scopeOverride },
    );
    expect(factValues(result)).toEqual([]);
  });

  it('rejects one-use grant replay after successful or broadened validation', () => {
    const replayGrant = explicitExecution();
    const first = executeMemoryRecall(
      { subject: 'user', predicate: 'medical_status' },
      replayGrant,
    );
    const replay = executeMemoryRecall(
      { subject: 'user', predicate: 'medical_status' },
      replayGrant,
    );
    expect(factValues(first)).toEqual(['sensitive medical value']);
    expect(factValues(replay)).toEqual([]);

    const broadenedGrant = explicitExecution();
    executeMemoryRecall({ all: true }, broadenedGrant);
    expect(
      factValues(
        executeMemoryRecall({ subject: 'user', predicate: 'medical_status' }, broadenedGrant),
      ),
    ).toEqual([]);
  });

  it('rejects structurally forged grants and keeps restricted facts permanently invisible', () => {
    const forged = Object.freeze({
      kind: 'explicit_memory_recall_grant' as const,
    }) as ExplicitMemoryRecallGrant;
    expect(
      factValues(
        executeMemoryRecall(
          { subject: 'user', predicate: 'medical_status' },
          {
            ...BASE_EXECUTION,
            requestIdentity: REQUEST_IDENTITY,
            explicitUserRequestGrant: forged,
          },
        ),
      ),
    ).toEqual([]);

    const restrictedIdentity = {
      ...REQUEST_IDENTITY,
      currentUserMessageId: 'user-message-restricted-1',
      currentUserMessageText: 'What is my vault_secret?',
    };
    expect(
      factValues(
        executeMemoryRecall(
          { subject: 'user', predicate: 'vault_secret' },
          explicitExecution({ requestIdentity: restrictedIdentity }),
        ),
      ),
    ).toEqual([]);
  });

  it('fails closed when the request cannot name one exact subject and predicate', () => {
    expect(
      deriveExplicitMemoryRecallTarget('Tell me everything you remember about me.'),
    ).toBeNull();
    expect(deriveExplicitMemoryRecallTarget('Recall my medical_status. Then continue.')).toBeNull();
    expect(deriveExplicitMemoryRecallTarget('What is my medical_status?')).toEqual({
      subject: 'user',
      predicate: 'medical_status',
    });
    expect(deriveExplicitMemoryRecallTarget("What's my medical status?")).toEqual({
      subject: 'user',
      predicate: 'medical status',
    });
    expect(deriveExplicitMemoryRecallTarget('What\u2019s my medical-status?')).toEqual({
      subject: 'user',
      predicate: 'medical-status',
    });
    expect(deriveExplicitMemoryRecallTarget("What's my medical_information?")).toEqual({
      subject: 'user',
      predicate: 'medical_information',
    });
    expect(deriveExplicitMemoryRecallTarget("What's my contact_details?")).toEqual({
      subject: 'user',
      predicate: 'contact_details',
    });
    expect(
      deriveExplicitMemoryRecallTarget('Recall predicate `medical_status` for subject `user`.'),
    ).toEqual({ subject: 'user', predicate: 'medical_status' });
  });
});
