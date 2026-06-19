export const createDefaultConversations = (): any[] => [
  {
    id: 'conv1',
    title: 'Test Chat',
    messages: [
      { id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'msg2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
    ] as any[],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    providerId: 'openai',
    model: 'gpt-5.4',
    systemPrompt: 'You are helpful',
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      totalCalls: 0,
    },
    logs: [] as any[],
    agentRuns: [] as any[],
  },
];

export const createRunningAgentRun = (overrides: Partial<any> = {}): any => ({
  id: 'run-1',
  userMessageId: 'msg-user-tool',
  goal: 'Complete the current task.',
  status: 'running',
  controlGraph: createAgentRunControlGraphState(),
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  currentPhase: 'work',
  phases: [] as any[],
  checkpoints: [] as any[],
  summary: {
    assistantTurns: 1,
    startedTools: 1,
    completedTools: 1,
    failedTools: 0,
    spawnedSubAgents: 0,
  },
  ...overrides,
});

export function createAgentRunControlGraphState(overrides: Partial<any> = {}): any {
  const asyncWorkOverrides = overrides.asyncWork ?? {};

  return {
    version: 1,
    status: 'ready',
    iteration: 0,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: asyncWorkOverrides.pendingOperations?.length ?? 0,
    lastModelToolNames: [],
    turnDirectives: {
      forceFinalText: false,
      requireDelegationTool: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    audit: [],
    updatedAt: 1_700_000_000_500,
    ...overrides,
    asyncWork: {
      awaitingBackgroundWorkers: false,
      pendingOperations: [],
      updatedAt: 1_700_000_000_500,
      ...asyncWorkOverrides,
    },
  };
}

export function createAgentRunAsyncWorkControlGraph(
  params: {
    awaitingBackgroundWorkers?: boolean;
    pendingOperations?: any[];
    updatedAt?: number;
  } = {},
): any {
  const pendingOperations = params.pendingOperations ?? [];
  const updatedAt = params.updatedAt ?? 1_700_000_000_500;

  return createAgentRunControlGraphState({
    status: pendingOperations.length > 0 ? 'waiting_async' : 'ready',
    pendingAsyncCount: pendingOperations.length,
    asyncWork: {
      awaitingBackgroundWorkers: params.awaitingBackgroundWorkers === true,
      pendingOperations,
      updatedAt,
    },
    updatedAt,
  });
}

export const createStructuredPlan = (overrides: Partial<any> = {}): any => ({
  objective: 'Complete the current task.',
  successCriteria: ['Deliver the result', 'Verify the result'],
  stopConditions: ['Blocked'],
  workstreams: [
    {
      id: 'workstream-1',
      title: 'Implement the fix',
    },
    {
      id: 'workstream-2',
      title: 'Verify the fix',
      dependencies: ['workstream-1'],
    },
  ],
  updatedAt: 1_700_000_000_100,
  ...overrides,
});

let mockTimestamp = 1_700_100_000_000;

export function nextMockTimestamp() {
  mockTimestamp += 1;
  return mockTimestamp;
}

export function resetMockTimestamp() {
  mockTimestamp = 1_700_100_000_000;
}

export const buildMockPilotEvaluation = (overrides: Partial<any> = {}) => ({
  evaluatorVersion: 'pilot-v2',
  evaluatedAt: nextMockTimestamp(),
  objective: 'Complete the current task.',
  completionScore: 5,
  adherenceScore: 4,
  evidenceScore: 4,
  processScore: 4,
  overallScore: 17,
  maxOverallScore: 20,
  approvalThreshold: 16,
  approved: true,
  recommendedAction: 'finalize',
  controlAction: 'accept',
  confidence: 'high',
  summary: 'Pilot approved finalization.',
  rationale: 'The run satisfied the objective with verified evidence.',
  strengths: ['Verified evidence captured.'],
  gaps: [],
  nextActions: [],
  criterionEvaluations: [
    {
      criterion: 'Produce the requested deliverable.',
      score: 5,
      maxScore: 5,
      status: 'met',
      rationale: 'The deliverable is present.',
    },
    {
      criterion: 'Verify the result before finalizing.',
      score: 4,
      maxScore: 5,
      status: 'met',
      rationale: 'The result is verified enough for delivery.',
    },
  ],
  ...overrides,
});
