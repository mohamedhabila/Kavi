import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { areGoalSuccessCriteriaSatisfied } from '../../src/engine/goals/completionEvidence';
import {
  buildBaseParams,
  createGoal,
  createToolMessage,
  extractGoalEvidenceEvents,
  tool,
} from '../helpers/toolExecutionOutcomeHarness';

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
});
