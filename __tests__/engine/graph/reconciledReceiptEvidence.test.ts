import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';
import { canonicalizeToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeCanonicalization';
import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { createGoal, type AgentGoal } from '../../../src/engine/goals/types';

// Traced on the GLM 5.3 Flash suite (direct-mobileworld-cross-app-contact-message). Once
// sms_compose ran, its verified receipt sat on the graph, and the graph reconciles that
// receipt onto any goal patch whose criteria it satisfies — `evidence.tool:sms_compose`
// does. The mutation validator then refused the patch for "supplying" code-owned
// evidence the model never sent, so every add or update touching the draft goal failed,
// including the strictly monotonic append that was the model's only legal repair.

const digest = (fill: string) => `sha256:${fill.repeat(64)}` as const;

const smsReceipt = buildToolEffectReceiptEvidence({
  version: 2,
  receiptId: `ter_${'a'.repeat(32)}`,
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

function graphAfterSmsCompose(): AgentGoal[] {
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
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:sms_compose'],
      evidence: [
        'sms_compose:{"status":"sms_composer_opened","recipientCount":1,"messageLength":26}',
        smsReceipt,
      ],
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
  return { result: JSON.parse(outcome.toolMessage.content), goals: ref.current.goals ?? [] };
}

describe('evidence the graph reconciled onto a goal patch', () => {
  it('lets a goal naming an effectful tool be declared after that tool ran', () => {
    const { result, goals } = sendUpdateGoals(graphAfterSmsCompose(), {
      action: 'add',
      id: 'confirm-draft',
      name: 'Confirm the draft is ready',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:sms_compose'],
    });

    expect(result.errors).toBeUndefined();
    expect(result.status).toBe('ok');
    expect(goals.find((goal) => goal.id === 'confirm-draft')?.evidence).toContain(smsReceipt);
  });

  it('lets a goal holding a receipt take an appended criterion', () => {
    const { result, goals } = sendUpdateGoals(graphAfterSmsCompose(), {
      action: 'update',
      goals: [
        {
          id: 'avery-sms-draft',
          successCriteria: ['evidence.tool:sms_compose', 'evidence.json_field:recipientCount:1'],
        },
      ],
    });

    expect(result.errors).toBeUndefined();
    expect(goals.find((goal) => goal.id === 'avery-sms-draft')?.successCriteria).toEqual([
      'evidence.tool:sms_compose',
      'evidence.json_field:recipientCount:1',
    ]);
  });

  it('still refuses evidence the model writes into the call', () => {
    const { result } = sendUpdateGoals(graphAfterSmsCompose(), {
      action: 'update',
      goals: [{ id: 'avery-sms-draft', evidence: [smsReceipt] }],
    });

    expect(result.status).toBe('error');
    expect(result.errors).toEqual([
      'evidence is code-owned and cannot be supplied by update_goals.',
    ]);
  });
});
