import { prepareAgentControlGraphModelTurn } from '../../src/engine/graph/prepareAgentControlGraphModelTurn';
import { prepareAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import { planIterationModel } from '../../src/services/context/tokenOptimization';

jest.mock('../../src/engine/graph/agentTurnPreparation', () => {
  const actual = jest.requireActual('../../src/engine/graph/agentTurnPreparation');
  return {
    ...actual,
    prepareAgentTurn: jest.fn(),
  };
});

jest.mock('../../src/services/context/tokenOptimization', () => {
  const actual = jest.requireActual('../../src/services/context/tokenOptimization');
  return {
    ...actual,
    planIterationModel: jest.fn(),
  };
});

const mockedPrepareAgentTurn = jest.mocked(prepareAgentTurn);
const mockedPlanIterationModel = jest.mocked(planIterationModel);

const writeTool = {
  name: 'write_file',
  description: 'Write a file.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
} as any;

const sessionsSpawnTool = {
  name: 'sessions_spawn',
  description: 'Start a delegated worker session.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
    },
    required: ['prompt'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['coordinate'],
    resourceKinds: ['unknown'],
    sideEffects: ['external_run'],
  },
} as any;

const sessionsWaitTool = {
  name: 'sessions_wait',
  description: 'Wait for a delegated worker session to finish.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
    },
    required: ['sessionId'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['wait'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
  },
} as any;

const expoListProjectsTool = {
  name: 'expo_eas_list_projects',
  description: 'List Expo EAS projects.',
  input_schema: {
    type: 'object',
    properties: {},
  },
} as any;

const toolCatalogTool = {
  name: 'tool_catalog',
  description: 'Browse tools by category.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string' },
    },
    required: [],
  },
} as any;

const browserNavigateTool = {
  name: 'browser_navigate',
  description: 'Navigate browser pages.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
    },
    required: ['url'],
  },
} as any;

const browserSnapshotTool = {
  name: 'browser_snapshot',
  description: 'Inspect browser state.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as any;

function createBaseParams() {
  return {
    activeModel: 'gpt-5',
    activeProvider: {
      id: 'provider-openai',
      name: 'openai',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test',
      enabled: true,
      model: 'gpt-5',
    },
    allTools: [writeTool],
    completedWorkflowToolNames: new Set<string>(),
    goals: [],
    isSuperAgent: true,
    iteration: 3,
    maxTokens: 4096,
    promptContextSupport: {
      conversationMemory: null,
      globalMemory: null,
      maxToolIterations: 40,
      resolvedPrompt: 'You are a test agent.',
      skillPrompts: '',
    },
    requestAction: 'proceed' as const,
    thinkingLevel: 'low' as const,
    trackedAsyncOperations: new Map<string, any>(),
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    workingMessages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Create a file and reply with the result.',
        timestamp: 1,
      },
    ],
  };
}

function mockPreparedTurn() {
  mockedPrepareAgentTurn.mockReturnValue({
    enrichedSystemPrompt: 'Enriched prompt',
    enrichedSystemPromptSections: [],
    pinnedToolNames: [],
    selectedToolTokenEstimate: 0,
    selectedTools: [writeTool],
    toolsForIteration: [writeTool],
  });
}

function expectPreparedGroundedTools(
  expected: Array<{ name: string; placement: 'stable_prefix' | 'dynamic_suffix' }>,
) {
  const params = mockedPrepareAgentTurn.mock.calls[0]?.[0];
  expect(params?.groundedRequestScopedTools.map((tool) => ({
    name: tool.name,
    placement: tool.promptCache?.placement,
  }))).toEqual(expected);
  expect(params?.promptBundleContext.groundedRequestScopedTools.map((tool) => ({
    name: tool.name,
    placement: tool.promptCache?.placement,
  }))).toEqual(expected);
}

describe('prepareAgentControlGraphModelTurn', () => {
  beforeEach(() => {
    mockedPrepareAgentTurn.mockReset();
    mockedPlanIterationModel.mockReset();
  });

  it('returns a ready prepared turn with governance forcing and one-shot consumption', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    const result = await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      requestAction: 'clarify',
      turnDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        maxTokensOverride: 2048,
        incompleteFinalTextRecoveryCount: 0,
      },
    });

    expect(result.requestModel).toBe('gpt-5-mini');
    expect(result.requestMaxTokens).toBe(2048);
    expect(result.effectiveForceTextThisTurn).toBe(true);
    expect(result.effectiveForceTextReasonThisTurn).toBe('request_governance');
    expect(mockedPrepareAgentTurn).toHaveBeenCalledTimes(1);
  });

  it('treats forced-text proceed turns as non-actionable for budgeting and prompt memory', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      promptContextSupport: {
        ...createBaseParams().promptContextSupport,
        conversationMemory: 'Prior conversation memory',
        livingMemorySections: [{ text: 'Living memory section' }],
      },
      turnDirectives: {
        forceFinalText: true,
        forcedTextReason: 'request_governance',
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
    });

    expect(mockedPlanIterationModel).toHaveBeenCalledWith(
      expect.objectContaining({
        actionableRequest: false,
      }),
    );
    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        promptBundleContext: expect.objectContaining({
          conversationMemory: null,
          livingMemorySections: undefined,
        }),
      }),
    );
  });

  it('keeps graph mutation available as the core empty-goal affordance', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [
        writeTool,
        {
          name: 'update_goals',
          description: 'Goals',
          input_schema: { type: 'object', properties: {} },
        } as any,
      ],
      goals: [],
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        groundedRequestScopedTools: [
          expect.objectContaining({
            name: 'update_goals',
          }),
          expect.objectContaining({
            name: 'write_file',
          }),
        ],
      }),
    );
    expect(mockedPrepareAgentTurn.mock.calls[0]?.[0]).not.toHaveProperty('graphOwnsToolChoice');
  });

  it('treats proceed as an actionable request for prompt context', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      requestAction: 'proceed',
      promptContextSupport: {
        ...createBaseParams().promptContextSupport,
        conversationMemory: 'Prior conversation memory',
        livingMemorySections: [{ text: 'Living memory section' }],
      },
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        promptBundleContext: expect.objectContaining({
          conversationMemory: 'Prior conversation memory',
          livingMemorySections: [{ text: 'Living memory section' }],
        }),
      }),
    );
  });

  it('exposes only the stable discovery surface without graph session scope', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [
        writeTool,
        expoListProjectsTool,
        sessionsSpawnTool,
        sessionsWaitTool,
        toolCatalogTool,
      ],
      workingMessages: [
        {
          id: 'msg-1',
          role: 'user',
          content:
            'Use delegated worker to inspect package json and README md, wait for completion, and return exactly three bullets.',
          timestamp: 1,
        },
      ],
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        allowSessionCoordinationTools: false,
      }),
    );
    expectPreparedGroundedTools([
      { name: 'write_file', placement: 'stable_prefix' },
      { name: 'tool_catalog', placement: 'stable_prefix' },
    ]);
  });

  it('allows session coordination when graph goals scope session tools', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [sessionsSpawnTool, sessionsWaitTool, toolCatalogTool],
      goals: [
        {
          id: 'delegate-work',
          title: 'Delegate work',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['coordinate', 'wait'],
          requiredResourceKinds: ['unknown'],
        },
      ],
      workingMessages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Use a delegated worker for this task.',
          timestamp: 1,
        },
      ],
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        allowSessionCoordinationTools: true,
      }),
    );
    expectPreparedGroundedTools([
      { name: 'sessions_spawn', placement: 'dynamic_suffix' },
      { name: 'sessions_wait', placement: 'dynamic_suffix' },
    ]);
  });

  it('uses the stable discovery surface for ordinary turns without graph scope', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [writeTool, expoListProjectsTool, toolCatalogTool, browserNavigateTool],
    });

    expectPreparedGroundedTools([
      { name: 'write_file', placement: 'stable_prefix' },
      { name: 'tool_catalog', placement: 'stable_prefix' },
    ]);
  });

  it('does not let pending async work seize tool-choice ownership for the next turn', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [writeTool, sessionsWaitTool, toolCatalogTool],
      trackedAsyncOperations: new Map<string, any>([
        [
          'session:session-1',
          {
            key: 'session:session-1',
            kind: 'session',
            resourceId: 'session-1',
            displayName: 'Session session-1',
            status: 'running',
            lastUpdatedByTool: 'sessions_spawn',
            monitorToolNames: ['sessions_wait', 'sessions_cancel'],
            statusArgs: { sessionId: 'session-1' },
            waitToolName: 'sessions_wait',
            waitArgs: { sessionId: 'session-1' },
            updatedAt: 1,
          },
        ],
      ]),
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        allowSessionCoordinationTools: true,
      }),
    );
    expectPreparedGroundedTools([
      { name: 'write_file', placement: 'stable_prefix' },
      { name: 'sessions_wait', placement: 'dynamic_suffix' },
    ]);
  });

  it('loads discovered tool_catalog category tools on the following turn', async () => {
    mockedPlanIterationModel.mockReturnValue({
      model: 'gpt-5-mini',
      maxTokens: 1024,
      thinkingLevel: 'minimal',
      reason: 'test',
    } as any);
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [
        writeTool,
        toolCatalogTool,
        browserNavigateTool,
        browserSnapshotTool,
        expoListProjectsTool,
      ],
      workingMessages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Find the browser tools and continue.',
          timestamp: 1,
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc1',
              name: 'tool_catalog',
              arguments: '{"category":"browser"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'msg-3',
          role: 'tool',
          content: JSON.stringify({
            mode: 'category',
            category: 'browser',
            tools: [{ name: 'browser_navigate' }, { name: 'browser_snapshot' }],
          }),
          toolCallId: 'tc1',
          timestamp: 3,
        },
      ],
    });

    expectPreparedGroundedTools([
      { name: 'write_file', placement: 'stable_prefix' },
      { name: 'tool_catalog', placement: 'stable_prefix' },
      { name: 'browser_navigate', placement: 'dynamic_suffix' },
      { name: 'browser_snapshot', placement: 'dynamic_suffix' },
    ]);
  });
});
