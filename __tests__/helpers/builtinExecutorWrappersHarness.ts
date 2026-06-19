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

jest.mock('../../src/services/expo/projectState', () => ({
  getExpoProjectDisplayOwner: (...args: any[]) => mockGetExpoProjectDisplayOwner(...args),
  resolveExpoAccount: (...args: any[]) => mockResolveExpoAccount(...args),
  resolveExpoProject: (...args: any[]) => mockResolveExpoProject(...args),
}));

jest.mock('../../src/services/expo/projectAutomation', () => ({
  getExpoAutomationSummary: (...args: any[]) => mockGetExpoAutomationSummary(...args),
  getExpoProjectExecutionMode: (...args: any[]) => mockGetExpoProjectExecutionMode(...args),
  getExpoProjectReadiness: (...args: any[]) => mockGetExpoProjectReadiness(...args),
  getExpoProjectReadinessLabel: (...args: any[]) => mockGetExpoProjectReadinessLabel(...args),
}));

jest.mock('../../src/services/expo/projectCreation', () => ({
  createExpoProject: (...args: any[]) => mockCreateExpoProject(...args),
}));

jest.mock('../../src/services/expo/projectSync', () => ({
  listExpoProjects: (...args: any[]) => mockListExpoProjects(...args),
}));

jest.mock('../../src/services/expo/projectResolution', () => ({
  resolveExpoProjectForExecutionTask: (...args: any[]) =>
    mockResolveExpoProjectForExecutionTask(...args),
}));

jest.mock('../../src/services/expo/workflowMonitoring', () => ({
  inspectExpoWorkflowRun: (...args: any[]) => mockInspectExpoWorkflowRun(...args),
  listExpoWorkflowRuns: (...args: any[]) => mockListExpoWorkflowRuns(...args),
  waitForExpoWorkflowRun: (...args: any[]) => mockWaitForExpoWorkflowRun(...args),
}));

jest.mock('../../src/services/expo/rawGraphql', () => ({
  runExpoGraphqlQuery: (...args: any[]) => mockRunExpoGraphqlQuery(...args),
}));

jest.mock('../../src/services/expo/workflowActions', () => ({
  probeExpoProject: (...args: any[]) => mockProbeExpoProject(...args),
  runExpoProjectAction: (...args: any[]) => mockRunExpoProjectAction(...args),
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

jest.mock('../../src/engine/tools/resultNormalization/sshResult', () => ({
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

import { executeAgentsConfigure, executeAgentsList, executeAgentsSwitch } from '../../src/engine/tools/builtin-agents';
import { executeExpoEasBuild, executeExpoEasCreateProject, executeExpoEasDeployWeb, executeExpoEasListProjects, executeExpoEasProbe, executeExpoEasStatus, executeExpoEasSubmit, executeExpoEasUpdate } from '../../src/engine/tools/builtin-expoProjectExecution';
import { executeExpoEasGraphql, executeExpoEasWorkflowRuns, executeExpoEasWorkflowStatus, executeExpoEasWorkflowWait } from '../../src/engine/tools/builtin-expoWorkflowExecution';
import { executeMessageEffect, executePollCreate } from '../../src/engine/tools/builtin-interaction';
import { executeSessionCancel, executeSessionYield } from '../../src/engine/tools/builtin-session-control';
import { executeSessionHistory, executeSessionOutput, executeSessionSurfaceOutput } from '../../src/engine/tools/builtin-session-history';
import { executeSessionStatus } from '../../src/engine/tools/builtin-session-status';
import { executeSessionWait } from '../../src/engine/tools/builtin-session-wait';
import { executeSpeak } from '../../src/engine/tools/builtin-media';
import { executeSshDeletePath, executeSshExec, executeSshListDirectory, executeSshMakeDirectory, executeSshReadFile, executeSshRenamePath, executeSshWriteFile } from '../../src/engine/tools/builtin-ssh';
import { executeWait } from '../../src/engine/tools/builtin-utility';

export {
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
  executeSessionStatus,
  executeSessionSurfaceOutput,
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
  mockAsyncStorageSetItem,
  mockCancelSubAgent,
  mockCreateExpoProject,
  mockEnhancedExec,
  mockGetSubAgentsByParent,
  mockGetSubAgent,
  mockListExpoProjects,
  mockPersonasStore,
  mockPruneStaleCommandPolls,
  mockRecordCommandPoll,
  mockResetCommandPollCount,
  mockSpeakText,
  mockUpdatePersonaInConversation,
  mockWaitForSubAgentCompletion,
};

export function installBuiltinExecutorWrapperReset(): void {
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
}
