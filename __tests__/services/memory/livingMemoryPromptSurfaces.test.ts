jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { ensureDefaultBlocks } from '../../../src/services/memory/blocks';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { recordMemoryFactObservation } from '../../../src/services/memory/facts/observations';
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import { upsertReflection } from '../../../src/services/memory/reflections';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  editPromptEligibleWorkingBlock,
  editWorkingBlock,
} from '../../../src/services/memory/workingBlocks';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const CONVERSATION_ID = 'prompt-surface-conversation';
const SOURCE_THREAD_ID = 'prompt-surface-thread';

function messages(now: number): Message[] {
  return [
    {
      id: 'prompt-surface-user-message',
      role: 'user',
      content: 'continue',
      timestamp: now,
    } as Message,
  ];
}

function dynamicPrompt(output: Awaited<ReturnType<typeof buildLivingMemorySections>>): string {
  return output.sections
    .filter((section) => !section.cacheable)
    .map((section) => section.text)
    .join('\n');
}

async function buildPrompt(now: number) {
  return buildLivingMemorySections({
    messages: messages(now),
    conversationId: CONVERSATION_ID,
    sourceThreadId: SOURCE_THREAD_ID,
    personaId: 'default',
    taskId: null,
    disableRecall: true,
    now,
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
});

afterEach(() => {
  closeMemoryDb();
});

describe('living-memory prompt surface applicability', () => {
  it('rebuilds stored reflections from applicable sources instead of trusting stored content', async () => {
    const now = 10_000;
    const entity = upsertEntity({ name: 'user', type: 'self', now: 1_000 });
    const supported = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'prefers_editor',
        objectText: 'supported-user-stated-editor',
        scope: 'conversation',
        originConversationId: CONVERSATION_ID,
        originThreadId: SOURCE_THREAD_ID,
        sourceMessageId: 'supported-source-message',
        validAt: 2_000,
        now: 2_000,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    ).fact;
    const unsupported = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'prefers_theme',
        objectText: 'unsupported-assistant-inference',
        scope: 'conversation',
        originConversationId: CONVERSATION_ID,
        originThreadId: SOURCE_THREAD_ID,
        sourceMessageId: 'unsupported-source-message',
        validAt: 2_001,
        now: 2_001,
      },
      { factClass: 'subjective_user', sourceAuthority: 'assistant_inferred' },
    ).fact;
    upsertReflection({
      scope: 'thread',
      threadId: CONVERSATION_ID,
      periodStart: 0,
      periodEnd: 86_400_000,
      kind: 'daily_focus',
      content: 'forged reflection content containing unsupported-assistant-inference',
      sourceEpisodeIds: [],
      sourceFactIds: [supported.id, unsupported.id],
      now: 3_000,
    });

    const output = await buildPrompt(now);
    const prompt = dynamicPrompt(output);

    expect(prompt).toContain('### Day Focus');
    expect(prompt).toContain('supported-user-stated-editor');
    expect(prompt).not.toContain('forged reflection content');
    expect(prompt).not.toContain('unsupported-assistant-inference');
  });

  it('admits only structurally trusted working blocks to the prompt', async () => {
    const scope = {
      conversationId: CONVERSATION_ID,
      threadId: SOURCE_THREAD_ID,
    };
    editWorkingBlock('active_focus', 'unsupported-provider-working-focus', scope, { now: 2_000 });

    const untrustedOutput = await buildPrompt(3_000);
    expect(untrustedOutput.focusBlockText).toBe('');
    expect(dynamicPrompt(untrustedOutput)).not.toContain('unsupported-provider-working-focus');

    editPromptEligibleWorkingBlock('active_focus', 'trusted-structural-working-focus', scope, {
      now: 4_000,
    });

    const trustedOutput = await buildPrompt(5_000);
    expect(trustedOutput.focusBlockText).toBe('trusted-structural-working-focus');
    expect(dynamicPrompt(trustedOutput)).toContain('trusted-structural-working-focus');
  });

  it('honors both observation clocks when revalidating reflection sources as of a turn', async () => {
    const entity = upsertEntity({ name: 'user', type: 'self', now: 1_000 });
    const fact = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'prefers_layout',
        objectText: 'bi-temporal-user-stated-layout',
        scope: 'conversation',
        originConversationId: CONVERSATION_ID,
        originThreadId: SOURCE_THREAD_ID,
        sourceMessageId: 'bi-temporal-source-message',
        validAt: 2_000,
        now: 2_000,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    ).fact;
    upsertReflection({
      scope: 'thread',
      threadId: CONVERSATION_ID,
      periodStart: 0,
      periodEnd: 86_400_000,
      kind: 'daily_focus',
      content: 'stored reflection content is rebuilt',
      sourceEpisodeIds: [],
      sourceFactIds: [fact.id],
      now: 2_100,
    });
    recordMemoryFactObservation(
      {
        factId: fact.id,
        relation: 'conflicts',
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        sourceKind: 'user_message',
        sourceId: 'later-recorded-conflict-message',
        sourceScope: resolveLocalMemoryAccessScope({
          memoryConversationId: CONVERSATION_ID,
          sourceThreadId: SOURCE_THREAD_ID,
          personaId: 'default',
          taskId: null,
        }),
        observedAt: 2_500,
        createdAt: 5_000,
      },
      5_000,
    );

    expect(dynamicPrompt(await buildPrompt(3_000))).toContain('bi-temporal-user-stated-layout');
    expect(dynamicPrompt(await buildPrompt(6_000))).not.toContain('bi-temporal-user-stated-layout');
  });
});
