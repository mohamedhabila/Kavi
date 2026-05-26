const mockListActiveSubAgents = jest.fn();
const mockGetSubAgent = jest.fn();
const mockGetSubAgentsByParent = jest.fn();
const mockWaitForSubAgentCompletion = jest.fn();
const mockCancelSubAgent = jest.fn();
const mockRecordCommandPoll = jest.fn();
const mockResetCommandPollCount = jest.fn();
const mockPruneStaleCommandPolls = jest.fn();
const mockResolveSshTarget = jest.fn();
const mockExecuteSshCommand = jest.fn();
const mockListSshDirectory = jest.fn();
const mockReadSshTextFile = jest.fn();
const mockWriteSshTextFile = jest.fn();
const mockRenameSshPath = jest.fn();
const mockDeleteSshPath = jest.fn();
const mockMakeSshDirectory = jest.fn();
const mockEnhancedExec = jest.fn();
const mockAsyncStorageGetItem = jest.fn();
const mockAsyncStorageSetItem = jest.fn();
const mockListExpoProjects = jest.fn();
const mockCreateExpoProject = jest.fn();
const mockResolveExpoProjectForExecutionTask = jest.fn();
const mockResolveExpoProject = jest.fn();
const mockResolveExpoAccount = jest.fn();
const mockGetExpoAutomationSummary = jest.fn();
const mockGetExpoProjectReadiness = jest.fn();
const mockGetExpoProjectReadinessLabel = jest.fn();
const mockGetExpoProjectExecutionMode = jest.fn();
const mockGetExpoProjectDisplayOwner = jest.fn();
const mockProbeExpoProject = jest.fn();
const mockRunExpoProjectAction = jest.fn();
const mockListExpoWorkflowRuns = jest.fn();
const mockInspectExpoWorkflowRun = jest.fn();
const mockWaitForExpoWorkflowRun = jest.fn();
const mockRunExpoGraphqlQuery = jest.fn();
const mockSpeakText = jest.fn();
const mockGetAvailablePersonas = jest.fn();
const mockGetPersona = jest.fn();
const mockIsBuiltInPersona = jest.fn();
const mockUpdatePersonaInConversation = jest.fn();

let mockIdCounter = 0;

const mockSettingsState: any = {};
const mockPersonasStore: any = {
  overrides: {},
  customPersonas: [],
  setOverride: jest.fn(),
  upsertCustomPersona: jest.fn(),
};

jest.mock('../../src/services/canvas/renderer', () => ({
  processCanvasMessage: jest.fn(),
  getSurface: jest.fn(),
  getAllSurfaces: jest.fn().mockReturnValue([]),
  getFocusedCanvasSurfaceId: jest.fn().mockReturnValue(null),
  requestCanvasEval: jest.fn(),
  requestCanvasRead: jest.fn(),
  requestCanvasSnapshot: jest.fn(),
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  cancelSubAgent: (...args: any[]) => mockCancelSubAgent(...args),
  spawnSubAgent: jest.fn(),
  startSubAgent: jest.fn(),
  launchSubAgent: jest.fn(),
  listActiveSubAgents: (...args: any[]) => mockListActiveSubAgents(...args),
  getSubAgent: (...args: any[]) => mockGetSubAgent(...args),
  getSubAgentsByParent: (...args: any[]) => mockGetSubAgentsByParent(...args),
  waitForSubAgentCompletion: (...args: any[]) => mockWaitForSubAgentCompletion(...args),
  getSessionContext: jest.fn(),
}));

jest.mock('../../src/services/agents/commandPollBackoff', () => ({
  recordCommandPoll: (...args: any[]) => mockRecordCommandPoll(...args),
  resetCommandPollCount: (...args: any[]) => mockResetCommandPollCount(...args),
  pruneStaleCommandPolls: (...args: any[]) => mockPruneStaleCommandPolls(...args),
}));

jest.mock('../../src/services/voice/voice', () => ({
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  transcribeAudio: jest.fn(),
  speakText: (...args: any[]) => mockSpeakText(...args),
}));

jest.mock('../../src/services/memory/store', () => ({
  searchMemory: jest.fn(),
}));

jest.mock('../../src/services/memory/embeddings', () => ({
  hybridSearch: jest.fn(),
}));

jest.mock('../../src/services/agents/personas', () => ({
  BUILT_IN_PERSONAS: [{ id: 'default' }],
}));

jest.mock('../../src/services/agents/registry', () => ({
  getAvailablePersonasForConfig: (...args: any[]) => mockGetAvailablePersonas(...args),
  getAvailablePersonas: (...args: any[]) => mockGetAvailablePersonas(...args),
  getPersona: (...args: any[]) => mockGetPersona(...args),
  isBuiltInPersona: (...args: any[]) => mockIsBuiltInPersona(...args),
}));

jest.mock('../../src/services/agents/store', () => ({
  usePersonaConfigStore: {
    getState: () => mockPersonasStore,
  },
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => ({
      updatePersonaInConversation: mockUpdatePersonaInConversation,
    }),
  },
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllStatuses: () => [],
    subscribe: () => () => undefined,
  },
}));

jest.mock('../../src/services/skills/manager', () => ({
  getSkillToolDefinitions: () => [],
  isSkillCompatible: () => ({ compatible: true }),
  useSkillsStore: {
    getState: () => ({ getEnabled: () => [] }),
  },
}));

jest.mock('../../src/services/expo/eas', () => ({
  createExpoProject: (...args: any[]) => mockCreateExpoProject(...args),
  getExpoAutomationSummary: (...args: any[]) => mockGetExpoAutomationSummary(...args),
  getExpoProjectDisplayOwner: (...args: any[]) => mockGetExpoProjectDisplayOwner(...args),
  getExpoProjectExecutionMode: (...args: any[]) => mockGetExpoProjectExecutionMode(...args),
  getExpoProjectReadiness: (...args: any[]) => mockGetExpoProjectReadiness(...args),
  getExpoProjectReadinessLabel: (...args: any[]) => mockGetExpoProjectReadinessLabel(...args),
  inspectExpoWorkflowRun: (...args: any[]) => mockInspectExpoWorkflowRun(...args),
  listExpoWorkflowRuns: (...args: any[]) => mockListExpoWorkflowRuns(...args),
  listExpoProjects: (...args: any[]) => mockListExpoProjects(...args),
  probeExpoProject: (...args: any[]) => mockProbeExpoProject(...args),
  resolveExpoProjectForExecutionTask: (...args: any[]) =>
    mockResolveExpoProjectForExecutionTask(...args),
  runExpoGraphqlQuery: (...args: any[]) => mockRunExpoGraphqlQuery(...args),
  resolveExpoAccount: (...args: any[]) => mockResolveExpoAccount(...args),
  resolveExpoProject: (...args: any[]) => mockResolveExpoProject(...args),
  runExpoProjectAction: (...args: any[]) => mockRunExpoProjectAction(...args),
  waitForExpoWorkflowRun: (...args: any[]) => mockWaitForExpoWorkflowRun(...args),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  deleteSshPath: (...args: any[]) => mockDeleteSshPath(...args),
  executeSshCommand: (...args: any[]) => mockExecuteSshCommand(...args),
  listSshDirectory: (...args: any[]) => mockListSshDirectory(...args),
  makeSshDirectory: (...args: any[]) => mockMakeSshDirectory(...args),
  readSshTextFile: (...args: any[]) => mockReadSshTextFile(...args),
  renameSshPath: (...args: any[]) => mockRenameSshPath(...args),
  resolveSshTarget: (...args: any[]) => mockResolveSshTarget(...args),
  writeSshTextFile: (...args: any[]) => mockWriteSshTextFile(...args),
}));

jest.mock('../../src/engine/tools/enhancedExec', () => ({
  enhancedExec: (...args: any[]) => mockEnhancedExec(...args),
}));

jest.mock('../../src/engine/tools/toolResultNormalization', () => ({
  normalizeSshExecResult: (payload: any) => JSON.stringify({ kind: 'exec', ...payload }),
  normalizeSshListResult: (payload: any) => JSON.stringify({ kind: 'list', ...payload }),
  normalizeSshMutationResult: (payload: any) => JSON.stringify({ kind: 'mutation', ...payload }),
  normalizeSshReadResult: (payload: any) => JSON.stringify({ kind: 'read', ...payload }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: any[]) => mockAsyncStorageGetItem(...args),
  setItem: (...args: any[]) => mockAsyncStorageSetItem(...args),
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  CameraType: { front: 'front', back: 'back' },
}));

jest.mock('../../src/utils/id', () => ({
  generateId: () => `gen-${++mockIdCounter}`,
}));

import {
  executeAgentsConfigure,
  executeAgentsList,
  executeAgentsSwitch,
  executeExpoEasBuild,
  executeExpoEasCreateProject,
  executeExpoEasDeployWeb,
  executeExpoEasGraphql,
  executeExpoEasListProjects,
  executeExpoEasProbe,
  executeExpoEasStatus,
  executeExpoEasSubmit,
  executeExpoEasUpdate,
  executeExpoEasWorkflowRuns,
  executeExpoEasWorkflowStatus,
  executeExpoEasWorkflowWait,
  executeMessageEffect,
  executePollCreate,
  executeSessionCancel,
  executeSessionHistory,
  executeSessionOutput,
  executeSessionSurfaceOutput,
  executeSessionStatus,
  executeSessionWait,
  executeSessionYield,
  executeSpeak,
  executeSshDeletePath,
  executeSshExec,
  executeSshListDirectory,
  executeSshMakeDirectory,
  executeSshReadFile,
  executeSshRenamePath,
  executeSshWriteFile,
  executeWait,
} from '../../src/engine/tools/parity-executor';

describe('parity-executor wrapper coverage', () => {
  beforeEach(() => {
    mockIdCounter = 0;
    jest.clearAllMocks();

    mockSettingsState.expoProjects = [];
    mockSettingsState.expoAccounts = [];
    mockSettingsState.sshTargets = [];

    mockPersonasStore.overrides = {};
    mockPersonasStore.customPersonas = [
      {
        id: 'custom-reviewer',
        name: 'Reviewer',
        description: 'Reviews changes',
        systemPrompt: 'Review carefully',
      },
    ];
    mockPersonasStore.setOverride.mockImplementation((personaId: string, patch: any) => {
      mockPersonasStore.overrides[personaId] = {
        ...(mockPersonasStore.overrides[personaId] || {}),
        ...patch,
      };
    });
    mockPersonasStore.upsertCustomPersona.mockImplementation((persona: any) => {
      const existingIndex = mockPersonasStore.customPersonas.findIndex(
        (entry: any) => entry.id === persona.id,
      );
      if (existingIndex >= 0) {
        mockPersonasStore.customPersonas[existingIndex] = persona;
      } else {
        mockPersonasStore.customPersonas.push(persona);
      }
    });

    const expoProject = {
      id: 'expo-1',
      accountId: 'acct-1',
      easProjectId: 'eas-1',
      name: 'Kavi',
      slug: 'kavi-app',
      fullName: '@kavi/kavi-app',
      source: 'synced',
      repoDefaultBranch: 'main',
      availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
      platforms: ['android', 'ios', 'web'],
      repoFullName: 'kavi/mobile',
      workflowFile: '.eas/workflows/deploy.yml',
      workflowRef: 'main',
      readiness: { launchable: true, reason: 'ready' },
    };
    const expoAccount = {
      id: 'acct-1',
      owner: 'kavi',
      name: 'Kavi',
    };
    const automation = {
      preferredFlow: 'commit-driven-eas-workflow',
      workflowFile: '.eas/workflows/deploy.yml',
      recommendedBranch: 'main',
      recommendedFlow: ['Commit changes and push to main.'],
    };

    mockResolveSshTarget.mockResolvedValue({ id: 'ssh-target', remoteRoot: '/srv/app' });
    mockExecuteSshCommand.mockResolvedValue('command output');
    mockListSshDirectory.mockResolvedValue([
      { filename: 'app', isDirectory: true, fileSize: 0, modificationDate: 123 },
    ]);
    mockReadSshTextFile.mockResolvedValue('file text');
    mockWriteSshTextFile.mockResolvedValue(undefined);
    mockRenameSshPath.mockResolvedValue(undefined);
    mockDeleteSshPath.mockResolvedValue(undefined);
    mockMakeSshDirectory.mockResolvedValue(undefined);
    mockEnhancedExec.mockResolvedValue(JSON.stringify({ kind: 'enhanced', status: 'ok' }));
    mockAsyncStorageGetItem.mockResolvedValue('{}');
    mockAsyncStorageSetItem.mockResolvedValue(undefined);

    mockResolveExpoProject.mockReturnValue(expoProject);
    mockResolveExpoAccount.mockReturnValue(expoAccount);
    mockGetExpoAutomationSummary.mockReturnValue(automation);
    mockGetExpoProjectReadiness.mockReturnValue({ launchable: true, reason: 'ready' });
    mockGetExpoProjectReadinessLabel.mockReturnValue('Ready');
    mockGetExpoProjectExecutionMode.mockReturnValue('eas-workflow');
    mockGetExpoProjectDisplayOwner.mockReturnValue('kavi');
    mockListExpoProjects.mockResolvedValue([expoProject]);
    mockResolveExpoProjectForExecutionTask.mockImplementation(({ projectRef }: any = {}) => {
      if (projectRef === 'expo-1' || projectRef === 'eas-1' || projectRef === '@kavi/kavi-app') {
        return Promise.resolve({
          status: 'resolved',
          project: expoProject,
          candidates: [expoProject],
          reason: 'project-ref',
          synced: false,
        });
      }

      return Promise.resolve({
        status: 'not_found',
        candidates: [],
        reason: 'no-projects',
        synced: false,
      });
    });
    mockCreateExpoProject.mockResolvedValue(expoProject);
    mockProbeExpoProject.mockResolvedValue({
      status: 'ok',
      ok: true,
      checks: [{ label: 'Repo linked', ok: true }],
      checkedAt: 111,
    });
    mockRunExpoProjectAction.mockImplementation(async (projectId: string, action: string) => ({
      status: 'ok',
      projectId,
      jobId: `job-${action}`,
      note: `${action} finished`,
      output: `${action} output line 1\n${action} output line 2`,
    }));
    mockListExpoWorkflowRuns.mockResolvedValue({
      status: 'ok',
      runs: [{ id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' }],
    });
    mockInspectExpoWorkflowRun.mockResolvedValue({
      status: 'ok',
      workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
      jobs: [{ name: 'build', status: 'SUCCESS' }],
    });
    mockWaitForExpoWorkflowRun.mockResolvedValue({
      status: 'ok',
      workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
      waitedMs: 2000,
    });
    mockRunExpoGraphqlQuery.mockResolvedValue({
      status: 'ok',
      projectId: 'expo-1',
      data: { viewer: { id: 'viewer-1' } },
    });

    mockGetAvailablePersonas.mockImplementation(() => [
      { id: 'default', name: 'Assistant', description: 'Built-in assistant', icon: 'A' },
      ...mockPersonasStore.customPersonas,
    ]);
    mockGetPersona.mockImplementation((personaId: string) =>
      mockGetAvailablePersonas().find((persona: any) => persona.id === personaId),
    );
    mockIsBuiltInPersona.mockImplementation((personaId: string) => personaId === 'default');
    mockSpeakText.mockResolvedValue(undefined);
  });

  it('returns session history with truncated output and recent activity entries', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-1',
      status: 'completed',
      startedAt: 1000,
      currentActivity: 'done',
      output: 'x'.repeat(5000),
      activityLog: [
        { kind: 'tool', text: 'Checked files', timestamp: 1 },
        { kind: 'message', text: 'Found issue', timestamp: 2 },
      ],
    });

    const parsed = JSON.parse(
      await executeSessionHistory({ sessionId: 'session-1', maxMessages: 1 }),
    );
    expect(parsed.status).toBe('completed');
    expect(parsed.activityLog).toEqual([{ kind: 'message', text: 'Found issue', timestamp: 2 }]);
    expect(parsed.messages).toEqual([
      { role: 'assistant', content: 'Found issue', timestamp: 2 },
      { role: 'assistant', content: 'x'.repeat(4000) },
    ]);
  });

  it('returns a missing-session error for session history', async () => {
    mockGetSubAgent.mockReturnValue(undefined);
    await expect(executeSessionHistory({ sessionId: 'missing' })).resolves.toBe(
      'Error: session not found: missing',
    );
  });

  it('returns full terminal output without transcript history for sessions_output', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-1',
      status: 'completed',
      startedAt: 1000,
      currentActivity: 'done',
      output: 'final worker deliverable',
      activityLog: [{ kind: 'tool', text: 'Checked files', timestamp: 1 }],
    });

    const parsed = JSON.parse(await executeSessionOutput({ sessionId: 'session-1' }));
    expect(parsed).toEqual({
      sessionId: 'session-1',
      status: 'completed',
      hasOutput: true,
      output: 'final worker deliverable',
      guidance:
        'Use sessions_output when you need to fetch or recall the full final worker output from a terminal session without waiting again. If that deliverable should become the visible user answer directly, use sessions_surface_output. If you already received this deliverable from sessions_wait, do not call sessions_output again unless you need to recall it later. Use sessions_history only when you need the transcript and reasoning trace. After you have the terminal deliverable you need, continue from it or finalize instead of polling sessions_status or sessions_list for the same completed session.',
    });
  });

  it('returns running guidance instead of transcript history for sessions_output', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-2',
      status: 'running',
      startedAt: 1000,
      currentActivity: 'working',
      output: undefined,
      activityLog: [],
    });

    const parsed = JSON.parse(await executeSessionOutput({ sessionId: 'session-2' }));
    expect(parsed).toEqual({
      sessionId: 'session-2',
      status: 'running',
      hasOutput: false,
      guidance:
        'Final output is not available yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or use sessions_status for live inspection while it is running.',
    });
  });

  it('returns surfaced worker output with supervisor wrapping for sessions_surface_output', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-surface',
      status: 'completed',
      startedAt: 1000,
      currentActivity: 'done',
      output: 'Header\n<answer>Exact worker deliverable</answer>\nFooter',
      activityLog: [],
    });

    const parsed = JSON.parse(
      await executeSessionSurfaceOutput({
        sessionId: 'session-surface',
        prefix: 'Preface:\n',
        suffix: '\nPostface.',
        startMarker: '<answer>',
        endMarker: '</answer>',
      }),
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'surfaced',
        sessionId: 'session-surface',
        output: 'Preface:\nExact worker deliverable\nPostface.',
        selectionApplied: true,
        usedFullOutput: false,
      }),
    );
  });

  it('returns running guidance for sessions_surface_output while the worker is still active', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-running-surface',
      status: 'running',
      startedAt: 1000,
      currentActivity: 'working',
      output: undefined,
      activityLog: [],
    });

    const parsed = JSON.parse(
      await executeSessionSurfaceOutput({ sessionId: 'session-running-surface' }),
    );

    expect(parsed).toEqual({
      sessionId: 'session-running-surface',
      status: 'running',
      hasOutput: false,
      guidance:
        'Worker output cannot be surfaced yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or use sessions_status for live inspection while it is running.',
    });
  });

  it('reports running session status with polling guidance and terminal status with reset behavior', async () => {
    const now = Date.now();
    mockPruneStaleCommandPolls.mockReturnValue(undefined);
    mockRecordCommandPoll.mockReturnValue(2500);
    mockGetSubAgent
      .mockReturnValueOnce({
        sessionId: 'run-1',
        status: 'running',
        startedAt: now - 5000,
        updatedAt: now - 1000,
        depth: 2,
        sandboxPolicy: 'safe-only',
        output: 'partial',
        currentActivity: 'Reading files',
        activeToolName: 'read_file',
        activeToolStartedAt: now - 400,
        lastToolResultPreview: 'README.md',
        activityLog: [{ text: 'Did work' }],
        toolsUsed: ['read_file'],
        iterations: 2,
      })
      .mockReturnValueOnce({
        sessionId: 'done-1',
        status: 'completed',
        startedAt: now - 9000,
        updatedAt: now - 100,
        depth: 1,
        sandboxPolicy: 'safe-only',
        output: 'final answer',
        activityLog: [],
        toolsUsed: [],
        iterations: 1,
      });

    const running = JSON.parse(await executeSessionStatus({ sessionId: 'run-1' }));
    expect(running.status).toBe('running');
    expect(running.hasNewActivity).toBe(true);
    expect(running.canCancel).toBe(true);
    expect(running.recommendedWaitMs).toBe(2500);
    expect(running.currentActivity).toBe('Reading files');
    expect(mockPruneStaleCommandPolls).toHaveBeenCalled();
    expect(mockRecordCommandPoll).toHaveBeenCalled();

    const terminal = JSON.parse(await executeSessionStatus({ sessionId: 'done-1' }));
    expect(terminal.status).toBe('completed');
    expect(terminal.recommendedWaitMs).toBeUndefined();
    expect(terminal.canCancel).toBe(false);
    expect(mockResetCommandPollCount).toHaveBeenCalled();
  });

  it('uses a bounded default wait window and returns full output plus preview metadata for large session results', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-1',
      status: 'running',
      startedAt: 1000,
      updatedAt: 2000,
      depth: 1,
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'session-1',
      status: 'completed',
      output: 'x'.repeat(5000),
      toolsUsed: ['read_file'],
      iterations: 2,
      depth: 1,
      artifacts: [],
    });

    const parsed = JSON.parse(await executeSessionWait({ sessionId: 'session-1' }, 'conv-1'));

    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('session-1', 180000);
    expect(parsed.status).toBe('completed');
    expect(parsed.completedCount).toBe(1);
    expect(parsed.pendingCount).toBe(0);
    expect(parsed.guidance).toContain(
      'already include the same full outputs that sessions_output would return',
    );
    expect(parsed.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        status: 'completed',
        hasOutput: true,
        output: 'x'.repeat(5000),
        outputPreview: 'x'.repeat(600),
        outputChars: 5000,
      }),
    );
    expect(parsed.sessions[0].guidance).toBeUndefined();
  });

  it('returns full outputs for every completed session when waiting on multiple workers together', async () => {
    mockGetSubAgent.mockImplementation((sessionId: string) => ({
      sessionId,
      status: 'running',
      startedAt: 1000,
      updatedAt: 2000,
      depth: 1,
    }));
    mockWaitForSubAgentCompletion
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        status: 'completed',
        output: 'first worker deliverable',
        toolsUsed: ['read_file'],
        iterations: 2,
        depth: 1,
        artifacts: [],
      })
      .mockResolvedValueOnce({
        sessionId: 'session-2',
        status: 'completed',
        output: 'y'.repeat(1400),
        toolsUsed: ['glob_search'],
        iterations: 3,
        depth: 1,
        artifacts: [],
      });

    const parsed = JSON.parse(
      await executeSessionWait({ sessionIds: ['session-1', 'session-2'] }, 'conv-1'),
    );

    expect(mockWaitForSubAgentCompletion).toHaveBeenNthCalledWith(1, 'session-1', 180000);
    expect(mockWaitForSubAgentCompletion).toHaveBeenNthCalledWith(2, 'session-2', 180000);
    expect(parsed.status).toBe('completed');
    expect(parsed.sessionIds).toEqual(['session-1', 'session-2']);
    expect(parsed.completedCount).toBe(2);
    expect(parsed.pendingCount).toBe(0);
    expect(parsed.guidance).toContain(
      'already include the same full outputs that sessions_output would return',
    );
    expect(parsed.sessions).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        status: 'completed',
        hasOutput: true,
        output: 'first worker deliverable',
        outputChars: 'first worker deliverable'.length,
      }),
      expect.objectContaining({
        sessionId: 'session-2',
        status: 'completed',
        hasOutput: true,
        output: 'y'.repeat(1400),
        outputPreview: 'y'.repeat(600),
        outputChars: 1400,
      }),
    ]);
  });

  it('surfaces default wait-window expiry when sessions remain running', async () => {
    const now = Date.now();
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-2',
      status: 'running',
      startedAt: now - 20_000,
      updatedAt: now - 1_000,
      depth: 1,
      currentActivity: 'Still working',
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce(null);

    const parsed = JSON.parse(await executeSessionWait({ sessionId: 'session-2' }, 'conv-1'));

    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('session-2', 180000);
    expect(parsed.status).toBe('running');
    expect(parsed.waitTimedOut).toBe(true);
    expect(parsed.waitTimeoutMs).toBe(180000);
    expect(parsed.usedDefaultWaitTimeout).toBe(true);
    expect(parsed.pendingCount).toBe(1);
    expect(parsed.guidance).toContain('The wait window ended');
  });

  it('honors explicit waitTimeoutMs overrides for sessions_wait', async () => {
    const now = Date.now();
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-3',
      status: 'running',
      startedAt: now - 20_000,
      updatedAt: now - 1_000,
      depth: 1,
      currentActivity: 'Still working',
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce(null);

    const parsed = JSON.parse(
      await executeSessionWait({ sessionId: 'session-3', waitTimeoutMs: 5000 }, 'conv-1'),
    );

    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('session-3', 5000);
    expect(parsed.status).toBe('running');
    expect(parsed.waitTimedOut).toBe(true);
    expect(parsed.waitTimeoutMs).toBe(5000);
    expect(parsed.usedDefaultWaitTimeout).toBeUndefined();
  });

  it('uses launchState and lastProgressAt when diagnosing queued workers', async () => {
    const now = Date.now();
    mockPruneStaleCommandPolls.mockReturnValue(undefined);
    mockRecordCommandPoll.mockReturnValue(2500);
    mockGetSubAgent.mockReturnValue({
      sessionId: 'queued-1',
      status: 'running',
      startedAt: now - 70_000,
      updatedAt: now - 1_000,
      lastProgressAt: now - 60_000,
      depth: 1,
      sandboxPolicy: 'safe-only',
      launchState: 'queued',
      currentActivity: 'Still starting worker runtime',
      activityLog: [],
      toolsUsed: [],
      iterations: 0,
    });

    const parsed = JSON.parse(await executeSessionStatus({ sessionId: 'queued-1' }));
    expect(parsed.launchState).toBe('queued');
    expect(parsed.lastProgressAt).toBe(now - 60_000);
    expect(parsed.idleMs).toBeGreaterThanOrEqual(59_000);
    expect(parsed.liveness).toBe('stalled');
    expect(parsed.recommendedWaitMs).toBe(5000);
    expect(parsed.guidance).toContain('still bootstrapping');
  });

  it('keeps long initial model-response waits diagnosable without marking the worker stalled', async () => {
    const now = Date.now();
    mockPruneStaleCommandPolls.mockReturnValue(undefined);
    mockRecordCommandPoll.mockReturnValue(2500);
    mockGetSubAgent.mockReturnValue({
      sessionId: 'responding-1',
      status: 'running',
      startedAt: now - 70_000,
      updatedAt: now - 1_000,
      lastProgressAt: now - 60_000,
      modelResponsePendingSince: now - 60_000,
      depth: 1,
      sandboxPolicy: 'safe-only',
      launchState: 'active',
      currentActivity: 'Preparing initial response',
      activityLog: [],
      toolsUsed: [],
      iterations: 0,
    });

    const parsed = JSON.parse(await executeSessionStatus({ sessionId: 'responding-1' }));
    expect(parsed.awaitingModelResponse).toBe(true);
    expect(parsed.modelResponsePendingSince).toBe(now - 60_000);
    expect(parsed.modelResponseWaitMs).toBeGreaterThanOrEqual(59_000);
    expect(parsed.liveness).toBe('quiet');
    expect(parsed.guidance).toContain("waiting for the model's response");
  });

  it('returns running wait snapshots that preserve pending-model-response state', async () => {
    const now = Date.now();
    mockGetSubAgent.mockReturnValue({
      sessionId: 'responding-2',
      status: 'running',
      startedAt: now - 70_000,
      updatedAt: now - 1_000,
      lastProgressAt: now - 60_000,
      modelResponsePendingSince: now - 60_000,
      depth: 1,
      currentActivity: 'Preparing initial response',
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce(null);

    const parsed = JSON.parse(await executeSessionWait({ sessionId: 'responding-2' }, 'conv-1'));

    expect(parsed.status).toBe('running');
    expect(parsed.pendingSessions).toHaveLength(1);
    expect(parsed.pendingSessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'responding-2',
        status: 'running',
        awaitingModelResponse: true,
        modelResponsePendingSince: now - 60_000,
        liveness: 'quiet',
        currentActivity: 'Preparing initial response',
      }),
    );
  });

  it('cancels running sessions and returns terminal or missing-session responses when appropriate', async () => {
    mockGetSubAgent
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ sessionId: 'done-1', status: 'completed', output: 'done' })
      .mockReturnValueOnce({ sessionId: 'run-1', status: 'running', currentActivity: 'Working' });
    mockCancelSubAgent.mockReturnValue({ currentActivity: 'Stopping now' });

    await expect(executeSessionCancel({ sessionId: 'missing' })).resolves.toBe(
      'Error: session not found: missing',
    );

    const terminal = JSON.parse(await executeSessionCancel({ sessionId: 'done-1' }));
    expect(terminal.message).toContain('already in a terminal state');

    const running = JSON.parse(
      await executeSessionCancel({ sessionId: 'run-1', reason: 'Wrong task' }),
    );
    expect(running.status).toBe('cancel_requested');
    expect(running.currentActivity).toBe('Stopping now');
    expect(mockCancelSubAgent).toHaveBeenCalledWith('run-1', 'Wrong task');
  });

  it('returns checkpoint information for yielded sessions and a terminal finalize signal when no workers are running', async () => {
    mockGetSubAgentsByParent.mockReturnValueOnce([]).mockReturnValueOnce([
      {
        sessionId: 'run-1',
        status: 'running',
        startedAt: 1,
        currentActivity: 'Inspecting',
        activeToolName: 'read_file',
      },
      { sessionId: 'done-1', status: 'completed', startedAt: 2 },
    ]);

    const empty = JSON.parse(await executeSessionYield({}, 'conv-1'));
    expect(empty).toEqual({
      status: 'completed',
      message: 'Supervisor checkpoint recorded.',
      finalizeSupervisor: true,
      pendingSessions: [],
      guidance:
        'No running sub-agent sessions remain for this conversation. Finalize the supervisor response instead of waiting again.',
    });

    const yielded = JSON.parse(
      await executeSessionYield({ message: '  Checkpoint now  ' }, 'conv-1'),
    );
    expect(yielded.status).toBe('checkpointed');
    expect(yielded.message).toBe('Checkpoint now');
    expect(yielded.finalizeSupervisor).toBe(false);
    expect(yielded.pendingSessions).toEqual([
      {
        sessionId: 'run-1',
        status: 'running',
        startedAt: 1,
        currentActivity: 'Inspecting',
        activeToolName: 'read_file',
      },
    ]);
  });

  it('clamps wait durations to the supported range', async () => {
    jest.useFakeTimers();
    try {
      const shortWait = executeWait({ ms: 1, reason: 'short' });
      jest.advanceTimersByTime(100);
      await expect(shortWait).resolves.toBe(
        JSON.stringify({ status: 'waited', waitedMs: 100, reason: 'short' }),
      );

      const longWait = executeWait({ ms: 999999 });
      jest.advanceTimersByTime(60000);
      await expect(longWait).resolves.toBe(JSON.stringify({ status: 'waited', waitedMs: 60000 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses enhanced SSH execution when background mode or custom timeout is requested', async () => {
    await expect(executeSshExec({ command: 'tail -f logs', background: true })).resolves.toBe(
      JSON.stringify({ kind: 'enhanced', status: 'ok' }),
    );
    expect(mockEnhancedExec).toHaveBeenCalledWith(
      'tail -f logs',
      expect.objectContaining({ background: true }),
    );
  });

  it('runs SSH wrappers and normalizes exec, file, and directory payloads', async () => {
    const exec = JSON.parse(await executeSshExec({ command: 'pwd', cwd: '/srv/app' }));
    await Promise.resolve();
    await Promise.resolve();

    const list = JSON.parse(await executeSshListDirectory({ path: '/srv/app' }));
    const read = JSON.parse(await executeSshReadFile({ path: '/srv/app/README.md' }));
    const write = JSON.parse(
      await executeSshWriteFile({ path: '/srv/app/file.txt', content: 'hello' }),
    );
    const rename = JSON.parse(
      await executeSshRenamePath({ oldPath: '/srv/app/file.txt', newPath: '/srv/app/file-2.txt' }),
    );
    const remove = JSON.parse(
      await executeSshDeletePath({ path: '/srv/app/file-2.txt', recursive: true }),
    );
    const mkdir = JSON.parse(await executeSshMakeDirectory({ path: '/srv/app/new-dir' }));

    expect(exec).toEqual(
      expect.objectContaining({
        kind: 'exec',
        command: 'pwd',
        cwd: '/srv/app',
        output: 'command output',
      }),
    );
    expect(list).toEqual(expect.objectContaining({ kind: 'list', path: '/srv/app' }));
    expect(read).toEqual(
      expect.objectContaining({ kind: 'read', path: '/srv/app/README.md', content: 'file text' }),
    );
    expect(write).toEqual(
      expect.objectContaining({
        kind: 'mutation',
        action: 'written',
        path: '/srv/app/file.txt',
        size: 5,
      }),
    );
    expect(rename).toEqual(
      expect.objectContaining({
        kind: 'mutation',
        action: 'renamed',
        oldPath: '/srv/app/file.txt',
        newPath: '/srv/app/file-2.txt',
      }),
    );
    expect(remove).toEqual(
      expect.objectContaining({ kind: 'mutation', action: 'deleted', path: '/srv/app/file-2.txt' }),
    );
    expect(mkdir).toEqual(
      expect.objectContaining({ kind: 'mutation', action: 'created', path: '/srv/app/new-dir' }),
    );
    expect(mockAsyncStorageSetItem).toHaveBeenCalledWith(
      'kavi-ssh-cwd',
      JSON.stringify({ 'ssh-target': '/srv/app' }),
    );
  });

  it('normalizes Expo list, create, and status payloads with automation guidance', async () => {
    const list = JSON.parse(await executeExpoEasListProjects({ refresh: true }));
    const created = JSON.parse(
      await executeExpoEasCreateProject({ accountId: 'acct-1', name: 'Kavi' }),
    );
    const status = JSON.parse(await executeExpoEasStatus({ projectId: 'expo-1' }));

    expect(list).toEqual(
      expect.objectContaining({
        status: 'ok',
        count: 1,
        preferredFlow: 'commit-driven-eas-workflow',
        selection: expect.objectContaining({ defaultProjectId: 'expo-1' }),
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        status: 'ok',
        project: expect.objectContaining({ id: 'expo-1', name: 'Kavi' }),
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(status).toEqual(
      expect.objectContaining({
        status: 'ok',
        preferredFlow: 'commit-driven-eas-workflow',
        project: expect.objectContaining({ id: 'expo-1', name: 'Kavi' }),
      }),
    );
    expect(mockListExpoProjects).toHaveBeenCalledWith({ accountId: undefined, refresh: true });
    expect(mockCreateExpoProject).toHaveBeenCalledWith({ accountId: 'acct-1', name: 'Kavi' });
  });

  it('normalizes Expo probe, action, workflow, and GraphQL wrapper payloads', async () => {
    const probe = JSON.parse(await executeExpoEasProbe({ projectId: 'expo-1' }));
    const build = JSON.parse(
      await executeExpoEasBuild({ projectId: 'expo-1', platform: 'android' }),
    );
    const update = JSON.parse(await executeExpoEasUpdate({ projectId: 'expo-1', branch: 'main' }));
    const submit = JSON.parse(await executeExpoEasSubmit({ projectId: 'expo-1', platform: 'ios' }));
    const deploy = JSON.parse(
      await executeExpoEasDeployWeb({ projectId: 'expo-1', alias: 'prod' }),
    );
    const runs = JSON.parse(await executeExpoEasWorkflowRuns({ projectId: 'expo-1', limit: 5 }));
    const workflowStatus = JSON.parse(
      await executeExpoEasWorkflowStatus({ projectId: 'expo-1', workflowRunId: 'run-1' }),
    );
    const workflowWait = JSON.parse(
      await executeExpoEasWorkflowWait({
        projectId: 'expo-1',
        workflowRunId: 'run-1',
        timeoutMs: 1000,
      }),
    );
    const graphql = JSON.parse(
      await executeExpoEasGraphql({ query: '{ viewer { id } }', projectId: 'expo-1' }),
    );

    expect(probe).toEqual(
      expect.objectContaining({
        status: 'ok',
        ok: true,
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(build).toEqual(
      expect.objectContaining({
        status: 'ok',
        jobId: 'job-build',
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(update).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-update' }));
    expect(submit).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-submit' }));
    expect(deploy).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-deploy-web' }));
    expect(runs).toEqual(
      expect.objectContaining({
        status: 'ok',
        runs: [{ id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' }],
      }),
    );
    expect(workflowStatus).toEqual(
      expect.objectContaining({
        status: 'ok',
        workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
      }),
    );
    expect(workflowWait).toEqual(
      expect.objectContaining({
        status: 'ok',
        workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
        waitedMs: 2000,
      }),
    );
    expect(graphql).toEqual(
      expect.objectContaining({
        status: 'ok',
        preferredFlow: 'commit-driven-eas-workflow',
        data: { viewer: { id: 'viewer-1' } },
      }),
    );
  });

  it('validates poll creation and supported message effects', async () => {
    expect(JSON.parse(await executePollCreate({ question: '', options: ['A', 'B'] }))).toEqual({
      status: 'error',
      error: 'Poll question is required',
    });
    expect(
      JSON.parse(await executePollCreate({ question: 'Question', options: ['Only one'] })),
    ).toEqual({ status: 'error', error: 'At least two poll options are required' });

    const poll = JSON.parse(
      await executePollCreate({
        question: '  Ship it?  ',
        options: [' Yes ', 'No', ' Maybe '],
        allowMultiple: true,
        durationMs: 3000,
      }),
    );
    expect(poll).toEqual({
      status: 'created',
      poll: {
        id: expect.any(String),
        question: 'Ship it?',
        options: [
          { id: expect.any(String), label: 'Yes', votes: 0 },
          { id: expect.any(String), label: 'No', votes: 0 },
          { id: expect.any(String), label: 'Maybe', votes: 0 },
        ],
        allowMultiple: true,
        durationMs: 3000,
        createdAt: expect.any(Number),
      },
    });

    expect(JSON.parse(await executeMessageEffect({ effectId: 'invalid' }))).toEqual({
      status: 'error',
      error: 'Unsupported effect. Use confetti, balloons, or spotlight.',
    });
    expect(JSON.parse(await executeMessageEffect({ effectId: '  CONFETTI ' }))).toEqual({
      status: 'applied',
      effectId: 'confetti',
    });
  });

  it('speaks text successfully and returns an error payload when TTS fails', async () => {
    const success = JSON.parse(await executeSpeak({ text: 'Hello world', provider: 'system' }));
    expect(success).toEqual({ status: 'spoken', textLength: 11, provider: 'system' });
    expect(mockSpeakText).toHaveBeenCalledWith('Hello world', 'system');

    mockSpeakText.mockRejectedValueOnce(new Error('tts failed'));
    const failure = JSON.parse(await executeSpeak({ text: 'Hello world', provider: 'system' }));
    expect(failure).toEqual({ status: 'error', error: 'tts failed' });
  });

  it('lists agents, switches personas, and configures built-in, custom, and new personas', async () => {
    const listed = JSON.parse(await executeAgentsList());
    expect(listed.agents).toEqual([
      {
        id: 'default',
        name: 'Assistant',
        description: 'Built-in assistant',
        icon: 'A',
        custom: false,
      },
      {
        id: 'custom-reviewer',
        name: 'Reviewer',
        description: 'Reviews changes',
        icon: undefined,
        custom: true,
      },
    ]);

    await expect(executeAgentsSwitch({ personaId: 'missing' }, 'conv-1')).resolves.toBe(
      'Error: persona not found: missing. Use agents_list to see available personas.',
    );

    const switched = JSON.parse(await executeAgentsSwitch({ personaId: 'default' }, 'conv-1'));
    expect(switched).toEqual({ status: 'switched', personaId: 'default', name: 'Assistant' });
    expect(mockUpdatePersonaInConversation).toHaveBeenCalledWith('conv-1', 'default');

    const builtInConfigured = JSON.parse(
      await executeAgentsConfigure({
        personaId: 'default',
        name: 'Assistant Pro',
        temperature: 0.2,
      }),
    );
    expect(builtInConfigured).toEqual({
      status: 'configured',
      persona: { id: 'default', name: 'Assistant' },
    });
    expect(mockPersonasStore.setOverride).toHaveBeenCalledWith('default', {
      name: 'Assistant Pro',
      temperature: 0.2,
    });

    const customConfigured = JSON.parse(
      await executeAgentsConfigure({
        personaId: 'custom-reviewer',
        name: 'Reviewer Pro',
        systemPrompt: 'Review prod changes only',
      }),
    );
    expect(customConfigured).toEqual({
      status: 'configured',
      persona: { id: 'custom-reviewer', name: 'Reviewer Pro' },
    });

    const created = JSON.parse(
      await executeAgentsConfigure({
        personaId: 'new-specialist',
        systemPrompt: 'Handle niche tasks',
        providerId: 'openai',
      }),
    );
    expect(created).toEqual({
      status: 'created',
      persona: { id: 'new-specialist', name: 'new-specialist' },
    });
    expect(mockPersonasStore.upsertCustomPersona).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-specialist',
        name: 'new-specialist',
        providerId: 'openai',
        icon: '🔧',
      }),
    );
  });
});
