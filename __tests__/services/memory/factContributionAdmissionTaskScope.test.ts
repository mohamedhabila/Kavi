import {
  proveLegacyFactContributionSources,
  type LegacyFactAdmissionProofIndex,
} from '../../../src/services/memory/factContributionAdmissionProof';
import type { FactRow } from '../../../src/services/memory/facts/types';

const OWNER = 'vault-owner';
const FACT_ID = 'legacy-task-scoped-fact';
const MESSAGE_ID = 'legacy-task-message';
const TURN_ID = 'legacy-task-turn';

function factRow(): FactRow {
  return {
    id: FACT_ID,
    scope: 'conversation',
    origin_conversation_id: 'root-conversation',
    origin_thread_id: 'source-thread',
    origin_task_id: null,
    source_message_id: MESSAGE_ID,
    source_turn_id: TURN_ID,
    source_run_id: null,
  } as FactRow;
}

function aliasKey(sourceKind: 'message' | 'turn', sourceId: string): string {
  return JSON.stringify([OWNER, sourceKind, sourceId]);
}

function proofIndex(sibling: 'none' | 'task' | 'conversation'): LegacyFactAdmissionProofIndex {
  const siblingSources =
    sibling !== 'none'
      ? new Map([
          [
            aliasKey('message', MESSAGE_ID),
            [
              {
                job_id: 'sibling-job',
                memory_owner_id: OWNER,
                memory_conversation_id:
                  sibling === 'conversation' ? 'sibling-conversation' : 'root-conversation',
                source_thread_id: sibling === 'conversation' ? 'sibling-thread' : 'source-thread',
                task_id: sibling === 'conversation' ? 'task-one' : 'task-two',
                source_kind: 'message',
                source_id: MESSAGE_ID,
              },
            ],
          ],
          [
            aliasKey('turn', TURN_ID),
            [
              {
                job_id: 'sibling-job',
                memory_owner_id: OWNER,
                memory_conversation_id:
                  sibling === 'conversation' ? 'sibling-conversation' : 'root-conversation',
                source_thread_id: sibling === 'conversation' ? 'sibling-thread' : 'source-thread',
                task_id: sibling === 'conversation' ? 'task-one' : 'task-two',
                source_kind: 'turn',
                source_id: TURN_ID,
              },
            ],
          ],
        ])
      : new Map();
  return {
    evidenceByFactId: new Map([
      [
        FACT_ID,
        [
          {
            fact_id: FACT_ID,
            message_id: MESSAGE_ID,
            source_end_message_id: TURN_ID,
            conversation_id: 'root-conversation',
            thread_id: 'source-thread',
            task_id: 'task-one',
          },
        ],
      ],
    ]),
    receiptJobIdsByFactId: new Map(),
    jobSourcesByJobId: new Map(),
    jobSourcesByAlias: siblingSources,
  } as LegacyFactAdmissionProofIndex;
}

describe('legacy contribution task scope proof', () => {
  it('uses the task proved by exact episode evidence for a conversation fact', () => {
    expect(
      proveLegacyFactContributionSources({
        row: factRow(),
        memoryOwnerId: OWNER,
        index: proofIndex('none'),
      }),
    ).toMatchObject({
      status: 'proven',
      scope: { taskId: 'task-one' },
    });
  });

  it('rejects the same aliases when sibling tasks both remain plausible', () => {
    expect(
      proveLegacyFactContributionSources({
        row: factRow(),
        memoryOwnerId: OWNER,
        index: proofIndex('task'),
      }),
    ).toEqual({ status: 'rejected', reason: 'source_scope_ambiguous' });
  });

  it('filters reused aliases from sibling conversations through the exact fact origin', () => {
    expect(
      proveLegacyFactContributionSources({
        row: factRow(),
        memoryOwnerId: OWNER,
        index: proofIndex('conversation'),
      }),
    ).toMatchObject({
      status: 'proven',
      scope: {
        memoryConversationId: 'root-conversation',
        sourceThreadId: 'source-thread',
        taskId: 'task-one',
      },
    });
  });
});
