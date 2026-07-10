import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { areGoalSuccessCriteriaSatisfied } from '../../src/engine/goals/completionEvidence';
import {
  buildEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
} from '../../src/engine/goals/effectCompletionEvidence';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  applyGoalGraphEvents,
  buildBaseParams,
  createGoal,
  createToolMessage,
  extractGoalEvidenceEvents,
  tool,
} from '../helpers/toolExecutionOutcomeHarness';

const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}` as const;
const RESULT_DIGEST = `sha256:${'2'.repeat(64)}` as const;
const RESOURCE_DIGEST = `sha256:${'3'.repeat(64)}` as const;
const EFFECT_CRITERION = buildEffectCompletionCriterion({
  effectKind: 'artifact.write',
  requestDigest: REQUEST_DIGEST,
  resource: {
    kind: 'workspace_file',
    id: 'reports/final.md',
    digest: RESOURCE_DIGEST,
  },
  verificationState: 'verified',
});

function buildReceipt(patch: Partial<ToolEffectReceipt> = {}): ToolEffectReceipt {
  return {
    version: 1,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'tc-write',
    toolName: 'write_file',
    transportState: 'returned',
    effectKind: 'artifact.write',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: REQUEST_DIGEST,
    resultDigest: RESULT_DIGEST,
    resource: {
      kind: 'workspace_file',
      id: 'reports/final.md',
      digest: RESOURCE_DIGEST,
    },
    recordedAt: 1,
    ...patch,
  };
}

describe('tool execution outcome resolution', () => {
  it('auto-links structural evidence to active goals', async () => {
    const params = buildBaseParams();
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        {
          id: 'goal-1',
          title: 'Analyze data',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-python',
        toolMessage: createToolMessage({
          id: 'tc-python',
          name: 'python',
          content: JSON.stringify({
            status: 'completed',
            files: [{ path: 'reports/analysis.json' }],
          }),
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'GOAL_EVIDENCE_ADDED',
        goalId: 'goal-1',
        evidence: 'python:execution:success',
        timestamp: expect.any(Number),
      },
    ]);
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'GOAL_EVIDENCE_ADDED',
        goalId: 'goal-1',
        evidence: 'python:artifact:reports/analysis.json',
        timestamp: expect.any(Number),
      },
    ]);
  });

  it('routes memory evidence to memory goals without satisfying device goals', async () => {
    const params = buildBaseParams();
    params.groundedRequestScopedTools = [
      tool({
        name: 'memory_remember',
        contract: {
          capabilities: ['write'],
          resourceKinds: ['memory'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'memory_remember' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'memory-state',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['memory'],
          successCriteria: ['evidence.json_field:status:remembered'],
        }),
        createGoal({
          id: 'mobile-action',
          requiredCapabilities: ['write', 'verify'],
          requiredResourceKinds: ['device'],
          evidence: ['sms_compose:{"status":"sms_composer_opened"}'],
          successCriteria: ['evidence.json_field:status:sms_composer_opened'],
        }),
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-memory',
        toolMessage: createToolMessage({
          id: 'tc-memory',
          name: 'memory_remember',
          content: '{"status":"remembered","factId":"fact-1"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const evidenceEvents = extractGoalEvidenceEvents(params);
    expect(evidenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'memory-state',
          evidence: 'memory_remember:{"status":"remembered","factId":"fact-1"}',
        }),
      ]),
    );
    expect(new Set(evidenceEvents.map((event) => event.goalId))).toEqual(new Set(['memory-state']));
  });

  it('routes contact lookup evidence without completing SMS criteria prematurely', async () => {
    const params = buildBaseParams();
    const mobileGoal = createGoal({
      id: 'mobile-contact-message',
      requiredCapabilities: ['read', 'write', 'verify'],
      requiredResourceKinds: ['device'],
      successCriteria: [
        'evidence.json_field:0.id:e2e-contact-avery',
        'evidence.json_field:status:sms_composer_opened',
        'evidence.json_field:recipientCount:1',
      ],
    });
    params.groundedRequestScopedTools = [
      tool({
        name: 'contacts_search',
        contract: {
          capabilities: ['discover', 'read'],
          resourceKinds: ['device'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'contacts_search' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [mobileGoal],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-contacts',
        toolMessage: createToolMessage({
          id: 'tc-contacts',
          name: 'contacts_search',
          content: '[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const evidenceEvents = extractGoalEvidenceEvents(params);
    expect(evidenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'mobile-contact-message',
          evidence:
            'contacts_search:[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
        expect.objectContaining({
          goalId: 'mobile-contact-message',
          evidence: 'contacts_search:{"length":1}',
        }),
      ]),
    );
    expect(
      areGoalSuccessCriteriaSatisfied({
        ...mobileGoal,
        evidence: evidenceEvents.map((event) => event.evidence),
      }),
    ).toBe(false);
  });

  it('routes matching tool evidence to blocked goals before reactivation', async () => {
    const params = buildBaseParams();
    params.groundedRequestScopedTools = [
      tool({
        name: 'contacts_search',
        contract: {
          capabilities: ['discover', 'read'],
          resourceKinds: ['device'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'contacts_search' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'blocked-contact-message',
          status: 'blocked',
          requiredCapabilities: ['read', 'write', 'verify'],
          requiredResourceKinds: ['device'],
          completionPolicy: 'blocking',
          successCriteria: ['evidence.json_field:0.id:e2e-contact-avery'],
        }),
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-contacts',
        toolMessage: createToolMessage({
          id: 'tc-contacts',
          name: 'contacts_search',
          content: '[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(extractGoalEvidenceEvents(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'blocked-contact-message',
          evidence:
            'contacts_search:[{"id":"e2e-contact-avery","phoneNumbers":[{"number":"+15550101001"}]}]',
        }),
      ]),
    );
  });

  it('routes workspace write evidence only to conversation workspace goals', async () => {
    const params = buildBaseParams();
    params.groundedRequestScopedTools = [
      tool({
        name: 'write_file',
        contract: {
          capabilities: ['write', 'verify'],
          resourceKinds: ['conversation_workspace'],
        },
      }),
    ];
    params.executableToolCalls = [{ name: 'write_file' }];
    params.getGraphSnapshot = jest.fn().mockReturnValue({
      goals: [
        createGoal({
          id: 'workspace-artifact',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['conversation_workspace'],
        }),
        createGoal({
          id: 'memory-state',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['memory'],
        }),
        createGoal({
          id: 'mobile-action',
          requiredCapabilities: ['write'],
          requiredResourceKinds: ['device'],
        }),
      ],
    });
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-write',
        toolMessage: createToolMessage({
          id: 'tc-write',
          name: 'write_file',
          content: '{"status":"ok","path":"artifacts/out.txt"}',
        }),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const evidenceEvents = extractGoalEvidenceEvents(params);
    expect(evidenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: 'workspace-artifact',
          evidence: 'write_file:{"status":"ok","path":"artifacts/out.txt"}',
        }),
      ]),
    );
    expect(new Set(evidenceEvents.map((event) => event.goalId))).toEqual(
      new Set(['workspace-artifact']),
    );
  });

  it.each([
    {
      label: 'acknowledged',
      receipt: buildReceipt({ verificationState: 'acknowledged' }),
      isError: false,
    },
    {
      label: 'failed',
      receipt: buildReceipt({
        transportState: 'threw',
        effectState: 'failed',
        verificationState: 'unverified',
        resource: undefined,
      }),
      isError: true,
    },
    {
      label: 'cancelled',
      receipt: buildReceipt({
        transportState: 'rejected',
        effectState: 'cancelled',
        verificationState: 'unverified',
        resource: undefined,
      }),
      isError: true,
    },
  ])('persists and routes a $label effect receipt without completing the goal', async ({
    receipt,
    isError,
  }) => {
    const params = buildBaseParams();
    let graph = {
      goals: [
        createGoal({
          id: 'write-final',
          completionPolicy: 'blocking',
          successCriteria: [EFFECT_CRITERION],
        }),
      ],
    };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.executableToolCalls = [
      {
        name: 'write_file',
        arguments: '{"path":"reports/final.md","content":"done"}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-write',
        toolMessage: createToolMessage({
          id: 'tc-write',
          name: 'write_file',
          content: isError ? '{"status":"error"}' : '{"status":"written"}',
          isError,
        }),
        effectReceipt: receipt,
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    const receiptEvidence = extractGoalEvidenceEvents(params)
      .map((event) => event.evidence)
      .find((evidence) => parseToolEffectReceiptEvidence(evidence));
    expect(parseToolEffectReceiptEvidence(receiptEvidence ?? '')).toMatchObject({
      effectState: receipt.effectState,
      verificationState: receipt.verificationState,
      requestDigest: REQUEST_DIGEST,
    });
    expect(graph.goals[0]?.status).toBe('active');
    expect(
      params.applyGraphEvents.mock.calls
        .flatMap(([events]) => events)
        .find((event) => event.type === 'TOOL_RESULT_RECORDED')?.result.evidence,
    ).toEqual(expect.arrayContaining([receiptEvidence]));
  });

  it('auto-completes the request-bound goal only after the exact resource is verified', async () => {
    const params = buildBaseParams();
    let graph = {
      goals: [
        createGoal({
          id: 'write-final',
          completionPolicy: 'blocking',
          successCriteria: [EFFECT_CRITERION],
        }),
      ],
    };
    params.getGraphSnapshot = jest.fn(() => graph);
    params.applyGraphEvents = jest.fn((events) => {
      graph = applyGoalGraphEvents(graph, events);
    });
    params.executableToolCalls = [
      {
        name: 'write_file',
        arguments: '{"path":"reports/final.md","content":"done"}',
      },
    ];
    params.toolExecutionOutcomes = [
      {
        index: 0,
        toolCallId: 'tc-write',
        toolMessage: createToolMessage({
          id: 'tc-write',
          name: 'write_file',
          content: '{"status":"written"}',
        }),
        effectReceipt: buildReceipt(),
      },
    ];

    await resolveAgentControlGraphToolExecutionOutcomes(params);

    expect(graph.goals[0]?.status).toBe('completed');
    expect(
      graph.goals[0]?.evidence.some((evidence) => parseToolEffectReceiptEvidence(evidence)),
    ).toBe(true);
  });
});
