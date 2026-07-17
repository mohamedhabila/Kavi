import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import {
  buildEffectCompletionCriterion,
  buildToolEffectReceiptEvidence,
} from '../../src/engine/goals/effectCompletionEvidence';
import { evaluateCompletionGate } from '../../src/engine/graph/completionGate';
import type { AgentControlTurnDirectives } from '../../src/engine/graph/agentControlGraph';
import type { AgentGoal } from '../../src/types/agentRun';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  buildEffectCompletionContractBlock,
  resolveToolEffectCompletionRequirement,
} from '../../src/engine/toolExecution/toolEffectCompletionContract';

const EFFECT_REQUEST_DIGEST = `sha256:${'1'.repeat(64)}` as const;
const EFFECT_RESULT_DIGEST = `sha256:${'2'.repeat(64)}` as const;
const EFFECT_RESOURCE_DIGEST = `sha256:${'3'.repeat(64)}` as const;
const CONTRACT_DIGEST = `sha256:${'4'.repeat(64)}` as const;
const EFFECT_CRITERION = buildEffectCompletionCriterion({
  effectKind: 'artifact.write',
  requestDigest: EFFECT_REQUEST_DIGEST,
  resource: {
    kind: 'workspace_file',
    id: 'reports/final.md',
    digest: EFFECT_RESOURCE_DIGEST,
  },
  verificationState: 'verified',
});

function buildEffectReceipt(
  verificationState: ToolEffectReceipt['verificationState'],
): ToolEffectReceipt {
  return {
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'tc-write',
    toolName: 'write_file',
    executionRunId: 'execution-run-1',
    contractIdentity: {
      kind: 'code_owned',
      version: 1,
      toolName: 'write_file',
      schemaDigest: CONTRACT_DIGEST,
      capabilityContractDigest: CONTRACT_DIGEST,
      workflowContractDigest: CONTRACT_DIGEST,
      effectContractDigest: CONTRACT_DIGEST,
      executionPolicyDigest: CONTRACT_DIGEST,
    },
    transportState: 'returned',
    effectKind: 'artifact.write',
    effectState: 'applied',
    verificationState,
    requestDigest: EFFECT_REQUEST_DIGEST,
    resultDigest: EFFECT_RESULT_DIGEST,
    resource: {
      kind: 'workspace_file',
      id: 'reports/final.md',
      digest: EFFECT_RESOURCE_DIGEST,
    },
    recordedAt: 1,
  };
}
const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};
function createGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'g1',
    title: 'Build feature',
    status: 'pending',
    dependencies: [],
    evidence: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}
function buildBaseParams() {
  return {
    trackedOperations: new Map<string, TrackedAsyncOperation>(),
    pendingOperations: [] as TrackedAsyncOperation[],
    consecutivePendingAsyncNoToolTurns: 0,
    hasDraftContent: true,
    goals: [] as AgentGoal[],
    toolingEnabledForProvider: true,
    selectedToolCount: 2,
    forceTextThisTurn: false,
    fullContent: 'final answer',
    recoveryDirectives: baseTurnDirectives,
    completion: {
      completionStatus: 'complete' as const,
      finishReason: 'stop',
    },
    nextFinalizationMaxTokens: 4096,
  };
}

describe('completionGate', () => {
  it('holds once after a retryable non-graph tool error', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
          status: 'failed',
          result: JSON.stringify({
            status: 'error',
            code: 'invalid_phone_number',
            repair: {
              retryable: true,
              code: 'invalid_phone_number',
              invalidFields: ['recipients'],
            },
          }),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'tool_error_repair',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'tool_error_repair',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('latest tool call failed');
    expect(prompt).toContain('sms_compose: invalid_phone_number fields recipients');
    expect(prompt).toContain('discovery tools');
  });
  it('does not repeatedly hold after the bounded retryable tool-error repair pass', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 1,
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'sms_compose']),
      toolCallHistory: [
        {
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["Avery"],"message":"Hello"}',
          timestamp: 1,
          status: 'failed',
          result: JSON.stringify({
            status: 'error',
            code: 'invalid_phone_number',
            repair: {
              retryable: true,
              code: 'invalid_phone_number',
              invalidFields: ['recipients'],
            },
          }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('holds an empty finalization after an effect completion contract rejection', async () => {
    const argumentsText = JSON.stringify({
      subject: 'user',
      predicate: 'city',
      value: 'Utrecht',
      scope: 'global',
    });
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'memory_remember',
      argumentsText,
    });
    if (requirement.kind !== 'effectful') {
      throw new Error('memory_remember must have an effect completion contract');
    }

    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      hasDraftContent: false,
      fullContent: '',
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'memory_remember']),
      toolCallHistory: [
        {
          id: 'tc-memory',
          name: 'memory_remember',
          arguments: argumentsText,
          timestamp: 1,
          status: 'failed',
          result: buildEffectCompletionContractBlock(requirement),
        },
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'tool_error_repair',
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('memory_remember: completion_contract_required via update_goals');
    expect(prompt).toContain('commit that graph mutation first');
    expect(prompt).toContain('retry the original effect on the following iteration');
  });
  it('holds the first tool-free candidate for an actionable agentic request', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      requiresAgenticProgressValidation: true,
      fullContent:
        'I can verify this by checking the available device state and then recording the result. ' +
        'The answer depends on state outside the visible transcript, so I should not treat this as complete prose.',
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'no_tool_progress_retry',
        graphEvent: {
          type: 'FINALIZATION_HELD',
          reason: 'no_tool_progress_retry',
        },
        nextConsecutivePendingAsyncNoToolTurns: 1,
      }),
    );
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain(
      'Advice or information grounded entirely in visible context can be complete',
    );
    expect(prompt).toContain('Do not manufacture an external action');
  });

  it('requires structured clarification on a no-tool retry when that tool is available', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set([
        'request_clarification',
        'tool_catalog',
        'calendar_events',
      ]),
      toolCallHistory: [],
      requiresAgenticProgressValidation: true,
      fullContent:
        'I cannot continue the requested calendar change until the user supplies the missing execution detail. ' +
        'I should ask for that required information before making any external change.',
    });

    expect(decision).toMatchObject({
      type: 'hold',
      reason: 'no_tool_progress_retry',
    });
    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('call request_clarification now');
    expect(prompt).toContain('a prose-only question does not register the blocked request');
  });
  it('does not hold a tool-free answer outside agentic progress validation', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['tool_catalog', 'memory_recall']),
      toolCallHistory: [],
      fullContent: 'No problem.',
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('validates a short first-pass agentic candidate without language heuristics', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set(['request_clarification', 'cron']),
      toolCallHistory: [],
      fullContent: 'Need the task ID.',
      requiresAgenticProgressValidation: true,
    });

    expect(decision).toMatchObject({
      type: 'hold',
      reason: 'no_tool_progress_retry',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
  });
  it('allows the bounded agentic validation pass to finalize a direct answer', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      consecutivePendingAsyncNoToolTurns: 1,
      goals: [],
      selectedToolNames: new Set(['request_clarification', 'cron']),
      toolCallHistory: [],
      fullContent: 'The visible context is sufficient.',
      requiresAgenticProgressValidation: true,
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('allows finalization after multiple successful read-only results when no goal is required', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [],
      selectedToolNames: new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list', 'memory_recall']),
      toolCallHistory: [
        {
          id: 'tc-calendar',
          name: 'calendar_list',
          arguments: '{}',
          timestamp: 1,
          result: JSON.stringify([{ id: 'default', allowsModifications: true }]),
        },
        {
          id: 'tc-memory',
          name: 'memory_recall',
          arguments: '{"query":"calendar preferences"}',
          timestamp: 2,
          result: JSON.stringify({ facts: [] }),
        },
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('holds when evidence.tool criteria are unmet', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.tool:write_file'],
          evidence: ['read_file:config.json'],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'goal_evidence_incomplete',
        missingRequiredEvidenceLabels: ['g1:evidence.tool:write_file'],
      }),
    );
  });
  it('does not finalize a completed effect goal with only an unverified acknowledgement', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      toolingEnabledForProvider: false,
      selectedToolCount: 0,
      forceTextThisTurn: true,
      goals: [
        createGoal({
          status: 'completed',
          completionPolicy: 'blocking',
          successCriteria: [EFFECT_CRITERION],
          evidence: [buildToolEffectReceiptEvidence(buildEffectReceipt('acknowledged'))],
        }),
      ],
    });

    expect(decision).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'goal_evidence_incomplete',
        missingRequiredEvidenceLabels: [`g1:${EFFECT_CRITERION}`],
      }),
    );
  });
  it('allows an explicit blocker report after an applied effect cannot be verified', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'blocked',
          completionPolicy: 'blocking',
          blockedReason: 'Effect applied but verification was incomplete. Do not repeat.',
          successCriteria: [EFFECT_CRITERION],
          evidence: [buildToolEffectReceiptEvidence(buildEffectReceipt('acknowledged'))],
        }),
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('allows finalization after the exact effect resource is verified', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'completed',
          completionPolicy: 'blocking',
          successCriteria: [EFFECT_CRITERION],
          evidence: [buildToolEffectReceiptEvidence(buildEffectReceipt('verified'))],
        }),
      ],
    });

    expect(decision).toEqual({ type: 'ready' });
  });
  it('keeps missing evidence as a continuation condition in hold prompts', () => {
    const decision = evaluateCompletionGate({
      ...buildBaseParams(),
      goals: [
        createGoal({
          status: 'active',
          successCriteria: ['evidence.tool:write_file'],
          evidence: [],
        }),
      ],
    });

    const prompt = decision.type === 'hold' ? decision.systemPrompts.join('\n') : '';
    expect(prompt).toContain('Missing evidence criteria: g1:evidence.tool:write_file');
    expect(prompt).toContain('Continue executing until required goal evidence is recorded');
    expect(prompt).not.toContain('blockedReason');
  });
  it('returns ready when no blockers remain', () => {
    expect(
      evaluateCompletionGate({
        ...buildBaseParams(),
        goals: [createGoal({ status: 'completed' })],
      }),
    ).toEqual({ type: 'ready' });
  });
});
