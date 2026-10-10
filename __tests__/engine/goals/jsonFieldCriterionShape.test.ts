import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';
import { canonicalizeToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeCanonicalization';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { buildCriterionSatisfactionActions } from '../../../src/engine/goals/completionEvidence';
import { buildUnmetCompletionRequirementMessage } from '../../../src/engine/goals/completionRefusalMessage';
import { isBlockingGoalClosedWithoutProof } from '../../../src/engine/goals/goalProof';
import {
  describeJsonFieldCriterionAction,
  isJsonFieldAbsentFromResults,
  listToolResultFieldPaths,
} from '../../../src/engine/goals/jsonFieldCriterion';
import { createGoal, type AgentGoal } from '../../../src/engine/goals/types';

// Traced on the GLM 5.3 Flash suite (2026-10-10). A goal declared before its tool ran
// guessed the result's shape — `evidence.json_field:recipients.length:1` for an SMS
// compose that returns `recipientCount`, `clipboard.text` for a clipboard read that
// returns `text`. The work succeeded; the criterion could never match; blocking criteria
// are monotonic, so it could not be corrected; and the hint said to "write
// recipients.length with write_file", which sent the model fabricating JSON files. Both
// runs ended blocked with the work done.

const SMS_RESULT =
  'sms_compose:{"status":"sms_composer_opened","recipientCount":1,"messageLength":26}';
const CLIPBOARD_RESULT = 'clipboard_read:{"status":"read","text":"SPA-DIRECT-CLIP-42"}';
const CONTACTS_RESULT = 'contacts_search:[{"id":"e2e-contact-avery","name":"Avery Chen"}]';

const digest = (fill: string) => `sha256:${fill.repeat(64)}` as const;
const smsReceipt = buildToolEffectReceiptEvidence({
  version: 2,
  receiptId: `ter_${'b'.repeat(32)}`,
  toolCallId: 'call-sms',
  toolName: 'sms_compose',
  executionRunId: 'run-1',
  contractIdentity: {
    kind: 'code_owned',
    version: 1,
    toolName: 'sms_compose',
    schemaDigest: digest('5'),
    capabilityContractDigest: digest('5'),
    workflowContractDigest: digest('5'),
    effectContractDigest: digest('5'),
    executionPolicyDigest: digest('5'),
  },
  transportState: 'returned',
  effectKind: 'communication.draft_handoff',
  effectState: 'applied',
  verificationState: 'verified',
  requestDigest: digest('1'),
  resultDigest: digest('2'),
  resource: { kind: 'sms_draft', id: 'draft-1' },
  recordedAt: 1,
} satisfies ToolEffectReceipt);

describe('a json_field criterion read against the results a goal holds', () => {
  it('knows when no result carries the field', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:recipients.length:1', [SMS_RESULT])).toBe(
      true,
    );
    expect(
      isJsonFieldAbsentFromResults('evidence.json_field:clipboard.text:SPA-DIRECT-CLIP-42', [
        CLIPBOARD_RESULT,
      ]),
    ).toBe(true);
  });

  it('is not absent when the field is there with another value', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:recipientCount:2', [SMS_RESULT])).toBe(
      false,
    );
  });

  it('is not absent before any result exists, since the field may still arrive', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:recipientCount:1', [])).toBe(false);
    expect(
      isJsonFieldAbsentFromResults('evidence.json_field:recipientCount:1', [
        'sms_compose:observed_result:call-sms',
      ]),
    ).toBe(false);
  });

  it('reads a list result the way the criterion does, first entry included', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:id:e2e-contact-avery', [CONTACTS_RESULT])).toBe(
      false,
    );
  });

  it('lists the fields results carry, leaving out code-owned receipts', () => {
    expect(listToolResultFieldPaths([SMS_RESULT, smsReceipt])).toEqual([
      'status',
      'recipientCount',
      'messageLength',
    ]);
    expect(listToolResultFieldPaths([CONTACTS_RESULT])).toEqual(['length', '0.id', '0.name']);
  });

  it('bounds the list so a large result cannot flood the prompt', () => {
    const wide = `web_fetch:${JSON.stringify(
      Object.fromEntries(Array.from({ length: 40 }, (_unused, index) => [`field${index}`, index])),
    )}`;

    expect(listToolResultFieldPaths([wide])).toHaveLength(12);
  });

  it('names the fields the results carry instead of a file to write', () => {
    const action = describeJsonFieldCriterionAction({ path: 'recipients.length', value: '1' }, [
      SMS_RESULT,
    ]);

    expect(action).toContain('status, recipientCount, messageLength');
    expect(action).toContain('update_goals action "update"');
    expect(action).not.toContain('write_file');
  });

  it('quotes the value a result actually has when it differs', () => {
    expect(
      describeJsonFieldCriterionAction({ path: 'recipientCount', value: '2' }, [SMS_RESULT]),
    ).toBe(
      'the results this goal holds have recipientCount = 1, not 2; produce a result where recipientCount is 2',
    );
  });

  it('points at the tool before any result exists', () => {
    expect(describeJsonFieldCriterionAction({ path: 'status', value: 'read' }, [])).toBe(
      'call the tool whose JSON result has status equal to read',
    );
  });

  it('reaches the loop-recovery and refusal prompts with the goal evidence', () => {
    const goal = createGoal({
      id: 'clip',
      title: 'Clipboard',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.json_field:clipboard.text:SPA-DIRECT-CLIP-42'],
      evidence: [CLIPBOARD_RESULT],
    });

    expect(buildCriterionSatisfactionActions([goal])[0]).toContain('they carry status, text');
    expect(buildUnmetCompletionRequirementMessage(goal)).toContain('they carry status, text');
  });
});

function draftGoalClosedUnproven(criteria: string[]): AgentGoal[] {
  return [
    createGoal({
      id: 'effect-sms-compose',
      title: 'Verify sms_compose effect',
      status: 'completed',
      completionPolicy: 'blocking',
      owner: 'system:effect-completion',
      evidence: [smsReceipt],
    }),
    createGoal({
      id: 'avery-sms-draft',
      title: 'Open SMS composer to Avery',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: criteria,
      evidence: [SMS_RESULT, smsReceipt],
    }),
  ];
}

function sendUpdateGoals(goals: AgentGoal[], args: Record<string, unknown>) {
  const ref: { current: AgentRunControlGraphState } = {
    current: createInitialAgentRunControlGraphState({ goals }),
  };
  const toolCallId = 'tc-update-goals';
  const argumentsJson = JSON.stringify(args);
  const toolMessage: Message = {
    id: 'msg-tool-result',
    role: 'tool',
    content: '{"status":"ok"}',
    timestamp: 1,
    attachments: [],
    toolCallId,
    toolCalls: [
      { id: toolCallId, name: 'update_goals', arguments: argumentsJson, status: 'completed' },
    ],
  };
  const outcome = canonicalizeToolExecutionOutcome({
    outcome: { index: 0, toolCallId, toolMessage },
    toolName: 'update_goals',
    executableToolCalls: [{ name: 'update_goals', arguments: argumentsJson }],
    getGraphSnapshot: () => ref.current,
    applyGraphEvents: (events) => {
      for (const event of events) {
        if (event.type === 'GOALS_UPDATED') {
          ref.current = createInitialAgentRunControlGraphState({
            ...ref.current,
            goals: event.goals,
          });
        }
      }
    },
    conversationId: 'conv-test',
    warn: jest.fn(),
  });
  const goal = (ref.current.goals ?? []).find((entry) => entry.id === 'avery-sms-draft');
  return { result: JSON.parse(outcome.toolMessage.content), goal };
}

describe('correcting a criterion that names a field no result carries', () => {
  const traced = ['evidence.tool:sms_compose', 'evidence.json_field:recipients.length:1'];

  it('tells the model which field to use once the goal closes unproven', () => {
    const { result } = sendUpdateGoals(draftGoalClosedUnproven(traced), {
      action: 'complete',
      id: 'avery-sms-draft',
    });
    const reported = result.goals.find((entry: { id: string }) => entry.id === 'avery-sms-draft');

    expect(reported.proof.unmetCriteria).toEqual([
      expect.objectContaining({
        criterion: 'evidence.json_field:recipients.length:1',
        satisfyBy: expect.stringContaining('status, recipientCount, messageLength'),
      }),
    ]);
    expect(reported.proof.note).not.toContain('correct them with update_goals');
  });

  it('accepts the correction that hint asks for, and the goal is then proven', () => {
    const { result, goal } = sendUpdateGoals(draftGoalClosedUnproven(traced), {
      action: 'update',
      goals: [
        {
          id: 'avery-sms-draft',
          successCriteria: ['evidence.tool:sms_compose', 'evidence.json_field:recipientCount:1'],
        },
      ],
    });

    expect(result.errors).toBeUndefined();
    expect(goal?.successCriteria).toEqual([
      'evidence.tool:sms_compose',
      'evidence.json_field:recipientCount:1',
    ]);
    expect(goal && isBlockingGoalClosedWithoutProof(goal)).toBe(false);
  });

  it('keeps a field the results do carry, with a value they do not, locked', () => {
    const { result, goal } = sendUpdateGoals(
      draftGoalClosedUnproven(['evidence.tool:sms_compose', 'evidence.json_field:recipientCount:2']),
      {
        action: 'update',
        goals: [{ id: 'avery-sms-draft', successCriteria: ['evidence.tool:sms_compose'] }],
      },
    );

    expect(result.status).toBe('error');
    expect(goal?.successCriteria).toContain('evidence.json_field:recipientCount:2');
  });

  it('keeps every criterion that names a deliverable locked', () => {
    const { result } = sendUpdateGoals(draftGoalClosedUnproven(traced), {
      action: 'update',
      goals: [
        { id: 'avery-sms-draft', successCriteria: ['evidence.json_field:recipientCount:1'] },
      ],
    });

    expect(result.status).toBe('error');
  });
});

describe('a blocking goal closed with no criteria at all', () => {
  it('can be given one, as its close report says', () => {
    const goals = [
      createGoal({
        id: 'avery-sms-draft',
        title: 'Open SMS composer to Avery',
        status: 'completed',
        completionPolicy: 'blocking',
        evidence: [],
      }),
    ];
    const closed = sendUpdateGoals(goals, { action: 'complete', id: 'avery-sms-draft' });
    expect(closed.result.goals[0].proof.note).toContain(
      'Add a specific criterion naming the evidence the work produced',
    );

    const { result, goal } = sendUpdateGoals(goals, {
      action: 'update',
      goals: [{ id: 'avery-sms-draft', successCriteria: ['evidence.tool:sms_compose'] }],
    });

    expect(result.errors).toBeUndefined();
    expect(goal?.successCriteria).toEqual(['evidence.tool:sms_compose']);
  });
});
