import { prepareAgentControlGraphModelTurn } from '../../src/engine/graph/prepareAgentControlGraphModelTurn';
import { prepareAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import { planIterationMaxTokens } from '../../src/services/context/tokenOptimization';
import { useSettingsStore } from '../../src/store/useSettingsStore';

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
    planIterationMaxTokens: jest.fn(),
  };
});

const mockedPrepareAgentTurn = jest.mocked(prepareAgentTurn);
const mockedPlanIterationMaxTokens = jest.mocked(planIterationMaxTokens);

function memoryRead(text: string) {
  return {
    status: 'read' as const,
    section: { text, itemIds: [], turnIds: [] },
  };
}

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
      kind: 'remote' as const,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test',
      enabled: true,
      model: 'gpt-5',
    },
    allTools: [writeTool],
    completedWorkflowToolNames: new Set<string>(),
    iteration: 3,
    maxTokens: 4096,
    promptContextSupport: {
      maxToolIterations: 40,
      resolvedPrompt: 'You are a test agent.',
      skillPrompts: '',
    },
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
  expect(
    params?.groundedRequestScopedTools.map((tool) => ({
      name: tool.name,
      placement: tool.promptCache?.placement,
    })),
  ).toEqual(expected);
  expect(
    params?.promptBundleContext.groundedRequestScopedTools.map((tool) => ({
      name: tool.name,
      placement: tool.promptCache?.placement,
    })),
  ).toEqual(expected);
}

describe('prepareAgentControlGraphModelTurn', () => {
  beforeEach(() => {
    mockedPrepareAgentTurn.mockReset();
    mockedPlanIterationMaxTokens.mockReset();
    mockedPlanIterationMaxTokens.mockReturnValue(1024);
  });

  it('returns a ready prepared turn with governance forcing and one-shot consumption', async () => {
    mockPreparedTurn();

    const result = await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      turnDirectives: {
        forceFinalText: true,
        forcedTextReason: 'empty_delivery_recovery',
        requireWorkflowTool: false,
        maxTokensOverride: 2048,
        incompleteFinalTextRecoveryCount: 0,
      },
    });

    expect(result.requestModel).toBe('gpt-5');
    expect(result.requestMaxTokens).toBe(2048);
    expect(result.effectiveForceTextThisTurn).toBe(true);
    expect(result.effectiveForceTextReasonThisTurn).toBe('empty_delivery_recovery');
    expect(mockedPrepareAgentTurn).toHaveBeenCalledTimes(1);
  });

  it('treats forced-text proceed turns as non-actionable for memory', async () => {
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      promptContextSupport: {
        ...createBaseParams().promptContextSupport,
        memory: memoryRead('Living memory section'),
      },
      turnDirectives: {
        forceFinalText: true,
        forcedTextReason: 'empty_delivery_recovery',
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        promptBundleContext: expect.objectContaining({
          memorySection: undefined,
        }),
      }),
    );
    expect(mockedPrepareAgentTurn).toHaveBeenCalledTimes(1);
  });

  it('keeps the plan tool on the core surface', async () => {
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [
        writeTool,
        {
          name: 'update_plan',
          description: 'Plan',
          input_schema: { type: 'object', properties: {} },
        } as any,
      ],
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        groundedRequestScopedTools: [
          expect.objectContaining({
            name: 'update_plan',
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
    mockPreparedTurn();

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      promptContextSupport: {
        ...createBaseParams().promptContextSupport,
        memory: memoryRead('Living memory section'),
      },
    });

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        promptBundleContext: expect.objectContaining({
          memorySection: 'Living memory section',
        }),
      }),
    );
  });

  it('drops a memory section read before memory was turned off', async () => {
    mockPreparedTurn();
    useSettingsStore.setState({ disableLongTermMemory: true });

    try {
      await prepareAgentControlGraphModelTurn({
        ...createBaseParams(),
        promptContextSupport: {
          ...createBaseParams().promptContextSupport,
          memory: memoryRead('Private memory section'),
        },
      });
    } finally {
      useSettingsStore.setState({ disableLongTermMemory: false });
    }

    expect(mockedPrepareAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        promptBundleContext: expect.objectContaining({ memorySection: undefined }),
      }),
    );
  });

  it('exposes stable delegation primitives without prompt-language routing', async () => {
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
          content: 'Handle the repository task carefully.',
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
      { name: 'write_file', placement: 'stable_prefix' },
      { name: 'sessions_spawn', placement: 'stable_prefix' },
      { name: 'tool_catalog', placement: 'stable_prefix' },
    ]);
  });

  // Traced on Sonnet 5.5 (Claw-Anything): with the person's mail and notes connected but only
  // named in the capability index, Claude searched the workspace files, found nothing and asked
  // the person; with the integration's tools declared it opened the apps first (30 of 30).
  it("declares a connected integration's tools from the first turn, kept by the tool budget", async () => {
    mockPreparedTurn();
    const mailSearchTool = {
      name: 'mcp__mail__mail_search',
      description: '[Mail] Search the inbox.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    } as any;
    const calendarTool = {
      name: 'mcp__calendar__list_events',
      description: '[Calendar] List events.',
      input_schema: { type: 'object', properties: {} },
    } as any;

    await prepareAgentControlGraphModelTurn({
      ...createBaseParams(),
      allTools: [writeTool, toolCatalogTool, mailSearchTool, calendarTool],
    });

    expectPreparedGroundedTools([
      { name: 'write_file', placement: 'stable_prefix' },
      { name: 'tool_catalog', placement: 'stable_prefix' },
      { name: 'mcp__calendar__list_events', placement: 'stable_prefix' },
      { name: 'mcp__mail__mail_search', placement: 'stable_prefix' },
    ]);
    expect(mockedPrepareAgentTurn.mock.calls[0]?.[0].pinnedToolNames).toEqual(
      expect.arrayContaining(['mcp__calendar__list_events', 'mcp__mail__mail_search']),
    );
  });

  it('uses the stable discovery surface for ordinary turns without graph scope', async () => {
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
      { name: 'tool_catalog', placement: 'stable_prefix' },
      { name: 'sessions_wait', placement: 'dynamic_suffix' },
    ]);
  });

  it('loads discovered tool_catalog category tools on the following turn', async () => {
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
      // Activated tools follow the fixed core prefix, appended in the order they arrived.
      { name: 'browser_navigate', placement: 'dynamic_suffix' },
      { name: 'browser_snapshot', placement: 'dynamic_suffix' },
    ]);
  });
});
