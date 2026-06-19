import './toolDispatcherFileSystemMock';

const mockReadWorkspaceFile = jest.fn();
const mockWriteWorkspaceFile = jest.fn();
const mockListWorkspaceDirectory = jest.fn();
const mockMakeWorkspaceDirectory = jest.fn();
const mockRenameWorkspaceFile = jest.fn();
const mockDeleteWorkspaceFile = jest.fn();
const mockGetWorkspaceTargetControlStatus = jest.fn();
const mockLaunchWorkspaceBrowserSession = jest.fn();
const mockDelegateWorkspaceTask = jest.fn();
const mockBrowserNavigate = jest.fn();
const mockBrowserAct = jest.fn();
const mockBrowserScreenshot = jest.fn();
const mockBrowserSnapshot = jest.fn();
const mockBrowserConsoleMessages = jest.fn();
const mockBrowserPageErrors = jest.fn();
const mockBrowserNetworkRequests = jest.fn();
const mockBrowserSetCookies = jest.fn();
const mockBrowserClearCookies = jest.fn();
const mockBrowserGetCookies = jest.fn();
const mockBrowserStorageGet = jest.fn();
const mockBrowserStorageSet = jest.fn();
const mockBrowserStorageClear = jest.fn();
const mockBrowserSessionStatus = jest.fn();
const mockBrowserUpload = jest.fn();
const mockBrowserDownload = jest.fn();
const mockBrowserPdf = jest.fn();
const mockBrowserFillForm = jest.fn();
const mockBrowserDialog = jest.fn();
const mockExecutePython = jest.fn();
const mockRecordAgentRunEvidence = jest.fn();
const mockGetSubAgent = jest.fn();

let mockChatState: {
  conversations: Array<any>;
  recordAgentRunEvidence: (...args: any[]) => any;
};

jest.mock('../../src/services/workspaces/files', () => ({
  readWorkspaceFile: (...args: any[]) => mockReadWorkspaceFile(...args),
  writeWorkspaceFile: (...args: any[]) => mockWriteWorkspaceFile(...args),
  listWorkspaceDirectory: (...args: any[]) => mockListWorkspaceDirectory(...args),
  makeWorkspaceDirectory: (...args: any[]) => mockMakeWorkspaceDirectory(...args),
  renameWorkspaceFile: (...args: any[]) => mockRenameWorkspaceFile(...args),
  deleteWorkspaceFile: (...args: any[]) => mockDeleteWorkspaceFile(...args),
}));

jest.mock('../../src/services/workspaces/control', () => ({
  getWorkspaceTargetControlStatus: (...args: any[]) => mockGetWorkspaceTargetControlStatus(...args),
  launchWorkspaceBrowserSession: (...args: any[]) => mockLaunchWorkspaceBrowserSession(...args),
  delegateWorkspaceTask: (...args: any[]) => mockDelegateWorkspaceTask(...args),
}));

jest.mock('../../src/services/browser/automation/actions', () => ({
  browserNavigate: (...args: any[]) => mockBrowserNavigate(...args),
  browserAct: (...args: any[]) => mockBrowserAct(...args),
  browserScreenshot: (...args: any[]) => mockBrowserScreenshot(...args),
  browserSnapshot: (...args: any[]) => mockBrowserSnapshot(...args),
  browserSessionStatus: (...args: any[]) => mockBrowserSessionStatus(...args),
  browserFillForm: (...args: any[]) => mockBrowserFillForm(...args),
}));

jest.mock('../../src/services/browser/automation/state', () => ({
  browserSetCookies: (...args: any[]) => mockBrowserSetCookies(...args),
  browserClearCookies: (...args: any[]) => mockBrowserClearCookies(...args),
  browserGetCookies: (...args: any[]) => mockBrowserGetCookies(...args),
  browserStorageGet: (...args: any[]) => mockBrowserStorageGet(...args),
  browserStorageSet: (...args: any[]) => mockBrowserStorageSet(...args),
  browserStorageClear: (...args: any[]) => mockBrowserStorageClear(...args),
}));

jest.mock('../../src/services/browser/automation/artifacts', () => ({
  browserUpload: (...args: any[]) => mockBrowserUpload(...args),
  browserDownload: (...args: any[]) => mockBrowserDownload(...args),
  browserPdf: (...args: any[]) => mockBrowserPdf(...args),
  browserDialog: (...args: any[]) => mockBrowserDialog(...args),
}));

jest.mock('../../src/services/browser/automation/trace', () => ({
  browserConsoleMessages: (...args: any[]) => mockBrowserConsoleMessages(...args),
  browserPageErrors: (...args: any[]) => mockBrowserPageErrors(...args),
  browserNetworkRequests: (...args: any[]) => mockBrowserNetworkRequests(...args),
}));

jest.mock('../../src/services/browser/jobs', () => ({
  launchBrowserLiveSession: jest.fn().mockResolvedValue('browser-session-1'),
  stopBrowserLiveSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/python/pyodideBridge', () => ({
  executePython: (...args: any[]) => mockExecutePython(...args),
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatState,
  },
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  getSubAgent: (...args: any[]) => mockGetSubAgent(...args),
}));

const mockBuiltinToolFns = {
  executeCanvasList: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCanvasRead: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCanvasCreate: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCanvasUpdate: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCanvasDelete: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCanvasNavigate: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCanvasEval: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCanvasSnapshot: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeWait: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executePdfRead: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeCameraSnap: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeAudioTranscribe: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeMemorySearch: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshExec: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshBackgroundJobStatus: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshBackgroundJobWait: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshListDirectory: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshReadFile: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshWriteFile: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshRenamePath: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshDeletePath: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSshMakeDirectory: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasCreateProject: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasStatus: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasProbe: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasBuild: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasUpdate: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasSubmit: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasDeployWeb: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasWorkflowRuns: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasWorkflowStatus: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasWorkflowWait: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeExpoEasGraphql: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeToolCatalog: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeToolDescribe: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executePollCreate: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeMessageEffect: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSpeak: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeAgentsList: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeAgentsSwitch: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeAgentsConfigure: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
};

const mockSessionLaunchFns = {
  executeSessionSpawn: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionSend: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
};

const mockSessionInspectionFns = {
  executeSessionList: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionHistory: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionOutput: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionSurfaceOutput: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionStatus: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionWait: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionCancel: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
  executeSessionYield: jest.fn().mockResolvedValue(JSON.stringify({ status: 'ok' })),
};

jest.mock('../../src/engine/tools/builtin-canvas-runtime', () => ({
  executeCanvasList: (...args: any[]) => mockBuiltinToolFns.executeCanvasList(...args),
  executeCanvasRead: (...args: any[]) => mockBuiltinToolFns.executeCanvasRead(...args),
  executeCanvasNavigate: (...args: any[]) => mockBuiltinToolFns.executeCanvasNavigate(...args),
  executeCanvasEval: (...args: any[]) => mockBuiltinToolFns.executeCanvasEval(...args),
  executeCanvasSnapshot: (...args: any[]) => mockBuiltinToolFns.executeCanvasSnapshot(...args),
}));

jest.mock('../../src/engine/tools/builtin-canvas-mutationExecution', () => ({
  executeCanvasCreate: (...args: any[]) => mockBuiltinToolFns.executeCanvasCreate(...args),
  executeCanvasUpdate: (...args: any[]) => mockBuiltinToolFns.executeCanvasUpdate(...args),
  executeCanvasDelete: (...args: any[]) => mockBuiltinToolFns.executeCanvasDelete(...args),
}));

jest.mock('../../src/engine/tools/builtin-utility', () => ({
  executeWait: (...args: any[]) => mockBuiltinToolFns.executeWait(...args),
  executePdfRead: (...args: any[]) => mockBuiltinToolFns.executePdfRead(...args),
}));

jest.mock('../../src/engine/tools/builtin-media', () => ({
  executeCameraSnap: (...args: any[]) => mockBuiltinToolFns.executeCameraSnap(...args),
  executeAudioTranscribe: (...args: any[]) => mockBuiltinToolFns.executeAudioTranscribe(...args),
  executeSpeak: (...args: any[]) => mockBuiltinToolFns.executeSpeak(...args),
}));

jest.mock('../../src/engine/tools/builtin-memory', () => ({
  executeMemorySearch: (...args: any[]) => mockBuiltinToolFns.executeMemorySearch(...args),
}));

jest.mock('../../src/engine/tools/builtin-ssh', () => ({
  executeSshExec: (...args: any[]) => mockBuiltinToolFns.executeSshExec(...args),
  executeSshBackgroundJobStatus: (...args: any[]) =>
    mockBuiltinToolFns.executeSshBackgroundJobStatus(...args),
  executeSshBackgroundJobWait: (...args: any[]) =>
    mockBuiltinToolFns.executeSshBackgroundJobWait(...args),
  executeSshListDirectory: (...args: any[]) => mockBuiltinToolFns.executeSshListDirectory(...args),
  executeSshReadFile: (...args: any[]) => mockBuiltinToolFns.executeSshReadFile(...args),
  executeSshWriteFile: (...args: any[]) => mockBuiltinToolFns.executeSshWriteFile(...args),
  executeSshRenamePath: (...args: any[]) => mockBuiltinToolFns.executeSshRenamePath(...args),
  executeSshDeletePath: (...args: any[]) => mockBuiltinToolFns.executeSshDeletePath(...args),
  executeSshMakeDirectory: (...args: any[]) => mockBuiltinToolFns.executeSshMakeDirectory(...args),
}));

jest.mock('../../src/engine/tools/builtin-expoProjectExecution', () => ({
  executeExpoEasCreateProject: (...args: any[]) =>
    mockBuiltinToolFns.executeExpoEasCreateProject(...args),
  executeExpoEasStatus: (...args: any[]) => mockBuiltinToolFns.executeExpoEasStatus(...args),
  executeExpoEasProbe: (...args: any[]) => mockBuiltinToolFns.executeExpoEasProbe(...args),
  executeExpoEasBuild: (...args: any[]) => mockBuiltinToolFns.executeExpoEasBuild(...args),
  executeExpoEasUpdate: (...args: any[]) => mockBuiltinToolFns.executeExpoEasUpdate(...args),
  executeExpoEasSubmit: (...args: any[]) => mockBuiltinToolFns.executeExpoEasSubmit(...args),
  executeExpoEasDeployWeb: (...args: any[]) => mockBuiltinToolFns.executeExpoEasDeployWeb(...args),
}));

jest.mock('../../src/engine/tools/builtin-expoWorkflowExecution', () => ({
  executeExpoEasWorkflowRuns: (...args: any[]) =>
    mockBuiltinToolFns.executeExpoEasWorkflowRuns(...args),
  executeExpoEasWorkflowStatus: (...args: any[]) =>
    mockBuiltinToolFns.executeExpoEasWorkflowStatus(...args),
  executeExpoEasWorkflowWait: (...args: any[]) =>
    mockBuiltinToolFns.executeExpoEasWorkflowWait(...args),
  executeExpoEasGraphql: (...args: any[]) => mockBuiltinToolFns.executeExpoEasGraphql(...args),
}));

jest.mock('../../src/engine/tools/builtin-tool-catalog', () => ({
  executeToolCatalog: (...args: any[]) => mockBuiltinToolFns.executeToolCatalog(...args),
}));

jest.mock('../../src/engine/tools/builtin-tool-describe', () => ({
  executeToolDescribe: (...args: any[]) => mockBuiltinToolFns.executeToolDescribe(...args),
}));

jest.mock('../../src/engine/tools/builtin-interaction', () => ({
  executePollCreate: (...args: any[]) => mockBuiltinToolFns.executePollCreate(...args),
  executeMessageEffect: (...args: any[]) => mockBuiltinToolFns.executeMessageEffect(...args),
}));

jest.mock('../../src/engine/tools/builtin-agents', () => ({
  executeAgentsList: (...args: any[]) => mockBuiltinToolFns.executeAgentsList(...args),
  executeAgentsSwitch: (...args: any[]) => mockBuiltinToolFns.executeAgentsSwitch(...args),
  executeAgentsConfigure: (...args: any[]) => mockBuiltinToolFns.executeAgentsConfigure(...args),
}));

jest.mock('../../src/engine/tools/builtin-session-spawn', () => ({
  executeSessionSpawn: (...args: any[]) => mockSessionLaunchFns.executeSessionSpawn(...args),
}));

jest.mock('../../src/engine/tools/builtin-session-send', () => ({
  executeSessionSend: (...args: any[]) => mockSessionLaunchFns.executeSessionSend(...args),
}));

jest.mock('../../src/engine/tools/builtin-session-history', () => ({
  executeSessionList: (...args: any[]) => mockSessionInspectionFns.executeSessionList(...args),
  executeSessionHistory: (...args: any[]) =>
    mockSessionInspectionFns.executeSessionHistory(...args),
  executeSessionOutput: (...args: any[]) => mockSessionInspectionFns.executeSessionOutput(...args),
  executeSessionSurfaceOutput: (...args: any[]) =>
    mockSessionInspectionFns.executeSessionSurfaceOutput(...args),
}));

jest.mock('../../src/engine/tools/builtin-session-status', () => ({
  executeSessionStatus: (...args: any[]) => mockSessionInspectionFns.executeSessionStatus(...args),
}));

jest.mock('../../src/engine/tools/builtin-session-wait', () => ({
  executeSessionWait: (...args: any[]) => mockSessionInspectionFns.executeSessionWait(...args),
}));

jest.mock('../../src/engine/tools/builtin-session-control', () => ({
  executeSessionCancel: (...args: any[]) => mockSessionInspectionFns.executeSessionCancel(...args),
  executeSessionYield: (...args: any[]) => mockSessionInspectionFns.executeSessionYield(...args),
}));

// Mock native executor
jest.mock('../../src/engine/tools/native/executor', () => ({
  executeNativeTool: jest.fn().mockImplementation((name: string) => {
    if (name === 'notification_send') {
      return Promise.resolve(
        JSON.stringify({ status: 'notification_displayed', id: 'notification-id' }),
      );
    }
    if (name === 'notification_schedule') {
      return Promise.resolve(
        JSON.stringify({ status: 'notification_scheduled', id: 'notification-id' }),
      );
    }
    return Promise.resolve(JSON.stringify({ status: 'ok' }));
  }),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      activeProviderId: 'openai',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-image-2',
          enabled: true,
        },
      ],
      workspaceTargets: [
        {
          id: 'ws-1',
          name: 'Workspace A',
          rootPath: '/workspace/project',
          provider: 'code-server',
          enabled: true,
        },
      ],
      browserProviders: [
        {
          id: 'browser-1',
          name: 'Browserbase',
          provider: 'browserbase',
          baseUrl: 'https://browser.example.com',
          authMode: 'none',
          enabled: true,
        },
      ],
      sshTargets: [
        {
          id: 'ssh-1',
          name: 'Builder',
          host: 'ssh.example.com',
          port: 22,
          username: 'dev',
          enabled: true,
        },
      ],
    }),
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-image'),
}));

jest.mock('../../src/services/media/imageGeneration', () => ({
  generateImage: jest.fn().mockResolvedValue({
    status: 'generated',
    providerId: 'openai',
    model: 'gpt-image-2',
    mimeType: 'image/png',
    fileUri: 'file:///mock/cache/generated.png',
  }),
  editImage: jest.fn().mockResolvedValue({
    status: 'edited',
    providerId: 'openai',
    model: 'gpt-image-2',
    mimeType: 'image/png',
    fileUri: 'file:///mock/cache/edited.png',
    sourceCount: 1,
  }),
}));

// Mock web tools
jest.mock('../../src/engine/tools/web-search', () => ({
  executeWebSearch: jest.fn().mockResolvedValue(JSON.stringify({ results: [] })),
}));
jest.mock('../../src/engine/tools/web-fetch', () => ({
  executeWebFetch: jest.fn().mockResolvedValue('fetched'),
}));

// Mock extended tools
jest.mock('../../src/engine/tools/extended', () => ({
  executeFileEdit: jest.fn().mockResolvedValue('edited'),
  executeGlobSearch: jest.fn().mockResolvedValue('[]'),
  executeTextSearch: jest.fn().mockResolvedValue('[]'),
}));

// Mock services
jest.mock('../../src/services/mcp/bridge', () => ({
  parseMcpToolName: jest.fn().mockReturnValue(null),
  executeMcpTool: jest.fn(),
}));
jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: { getClients: () => new Map() },
}));
jest.mock('../../src/services/skills/manager', () => ({
  parseSkillToolName: jest.fn().mockReturnValue(null),
  executeSkillTool: jest.fn(),
}));
jest.mock('../../src/services/memory/store', () => ({
  appendConversationMemory: jest.fn(),
  appendGlobalMemory: jest.fn(),
  readConversationMemory: jest.fn().mockResolvedValue(null),
  readGlobalMemory: jest.fn().mockResolvedValue(null),
  searchMemory: jest.fn().mockResolvedValue([]),
  writeConversationMemory: jest.fn(),
  writeGlobalMemory: jest.fn(),
}));

const mockAddJob = jest.fn().mockReturnValue('job-1');
const mockGetJob = jest.fn();
const mockRemoveJob = jest.fn();
const mockEnableJob = jest.fn();
const mockDisableJob = jest.fn();
jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: {
    getState: () => ({
      addJob: mockAddJob,
      jobs: [],
      getJob: mockGetJob,
      removeJob: mockRemoveJob,
      enableJob: mockEnableJob,
      disableJob: mockDisableJob,
    }),
  },
}));
jest.mock('../../src/services/security/audit', () => ({
  logToolCall: jest.fn(),
}));

// Mock approval store — auto-approve everything in tests
jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn().mockReturnValue(false),
  requestToolApproval: jest.fn().mockResolvedValue('approved'),
}));

// Mock browser trace store
jest.mock('../../src/services/browser/traceStore', () => ({
  startBrowserTrace: jest.fn().mockReturnValue('trace-1'),
  completeBrowserTrace: jest.fn(),
}));

let mockIsAllowed = true;
jest.mock('../../src/services/security/permissions', () => ({
  useToolPermissionsStore: {
    getState: () => ({ isAllowed: () => mockIsAllowed }),
  },
}));
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('test-id'),
}));

type ExecuteToolFn = typeof import('../../src/engine/tools/index').executeTool;
type BuiltinToolModule = typeof mockBuiltinToolFns;
type SessionLaunchModule = typeof mockSessionLaunchFns;
type SessionInspectionModule = typeof mockSessionInspectionFns;
type MemoryStoreModule = {
  appendConversationMemory: jest.Mock;
  appendGlobalMemory: jest.Mock;
  readConversationMemory: jest.Mock;
  readGlobalMemory: jest.Mock;
  searchMemory: jest.Mock;
  writeConversationMemory: jest.Mock;
  writeGlobalMemory: jest.Mock;
};

export const CONV_ID = 'test-conv-123';

export type ToolDispatcherHarness = {
  executeTool: ExecuteToolFn;
  builtinMod: BuiltinToolModule;
  sessionLaunchMod: SessionLaunchModule;
  sessionInspectionMod: SessionInspectionModule;
  executeNativeTool: jest.Mock;
  generateImage: jest.Mock;
  editImage: jest.Mock;
  memoryStore: MemoryStoreModule;
  mockGetJob: typeof mockGetJob;
  mockExecutePython: typeof mockExecutePython;
  mockRecordAgentRunEvidence: typeof mockRecordAgentRunEvidence;
  mockGetWorkspaceTargetControlStatus: typeof mockGetWorkspaceTargetControlStatus;
  mockLaunchWorkspaceBrowserSession: typeof mockLaunchWorkspaceBrowserSession;
  mockDelegateWorkspaceTask: typeof mockDelegateWorkspaceTask;
  mockBrowserScreenshot: typeof mockBrowserScreenshot;
  mockBrowserSnapshot: typeof mockBrowserSnapshot;
  mockBrowserNetworkRequests: typeof mockBrowserNetworkRequests;
};

type LoadedToolDispatcherHarness = ToolDispatcherHarness & {
  resetExpoFileStore: () => void;
};

function loadTestModules(): LoadedToolDispatcherHarness {
  const { executeTool } = require('../../src/engine/tools/index') as {
    executeTool: ExecuteToolFn;
  };
  const { executeNativeTool } = require('../../src/engine/tools/native/executor') as {
    executeNativeTool: jest.Mock;
  };
  const { generateImage, editImage } = require('../../src/services/media/imageGeneration') as {
    generateImage: jest.Mock;
    editImage: jest.Mock;
  };
  const memoryStore = require('../../src/services/memory/store') as MemoryStoreModule;
  const { __resetStore: resetExpoFileStore } = require('expo-file-system') as {
    __resetStore: () => void;
  };

  return {
    executeTool,
    builtinMod: mockBuiltinToolFns,
    sessionLaunchMod: mockSessionLaunchFns,
    sessionInspectionMod: mockSessionInspectionFns,
    executeNativeTool,
    generateImage,
    editImage,
    memoryStore,
    mockGetJob,
    mockExecutePython,
    mockRecordAgentRunEvidence,
    mockGetWorkspaceTargetControlStatus,
    mockLaunchWorkspaceBrowserSession,
    mockDelegateWorkspaceTask,
    mockBrowserScreenshot,
    mockBrowserSnapshot,
    mockBrowserNetworkRequests,
    resetExpoFileStore,
  };
}

export function setupToolDispatcherHarness(): ToolDispatcherHarness {
  jest.resetModules();
  const harness = loadTestModules();
  harness.resetExpoFileStore();
  jest.clearAllMocks();
  mockIsAllowed = true;
  mockChatState = {
    conversations: [
      {
        id: CONV_ID,
        activeAgentRunId: 'run-1',
        agentRuns: [{ id: 'run-1', evidence: [] }],
      },
    ],
    recordAgentRunEvidence: (...args: any[]) => mockRecordAgentRunEvidence(...args),
  };
  mockRecordAgentRunEvidence.mockImplementation(
    () => mockChatState.conversations[0].agentRuns[0].evidence,
  );
  mockGetSubAgent.mockReturnValue(undefined);
  mockExecutePython.mockResolvedValue({ success: true, output: '42' });
  mockReadWorkspaceFile.mockResolvedValue({
    path: '/workspace/project/README.md',
    content: 'hello',
    size: 5,
  });
  mockWriteWorkspaceFile.mockResolvedValue({ path: '/workspace/project/README.md', size: 5 });
  mockListWorkspaceDirectory.mockResolvedValue({ path: '/workspace/project', entries: [] });
  mockMakeWorkspaceDirectory.mockResolvedValue(undefined);
  mockRenameWorkspaceFile.mockResolvedValue(undefined);
  mockDeleteWorkspaceFile.mockResolvedValue(undefined);
  mockGetWorkspaceTargetControlStatus.mockReturnValue({
    targetId: 'ws-1',
    summary: 'Workspace A is ready.',
  });
  mockLaunchWorkspaceBrowserSession.mockResolvedValue({
    sessionId: 'workspace-browser-session-1',
    providerId: 'browser-1',
    url: 'https://workspace.example.com',
  });
  mockDelegateWorkspaceTask.mockResolvedValue({
    providerLabel: 'Cursor CLI',
    targetId: 'ws-1',
    sshTargetId: 'ssh-1',
    mode: 'agent',
    command: 'cursor-agent --prompt',
    output: 'Delegated task completed successfully.',
  });
  mockBrowserNavigate.mockResolvedValue({
    ok: true,
    targetId: 'page-1',
    url: 'https://example.com',
  });
  mockBrowserAct.mockResolvedValue({ ok: true, targetId: 'page-1' });
  mockBrowserScreenshot.mockResolvedValue({
    ok: true,
    targetId: 'page-1',
    url: 'https://example.com',
    imageBase64: 'AAAA',
  });
  mockBrowserSnapshot.mockResolvedValue({
    ok: true,
    targetId: 'page-1',
    snapshot: 'Hero heading\nPrimary CTA',
    truncated: false,
  });
  mockBrowserConsoleMessages.mockResolvedValue({ ok: true, targetId: 'page-1', messages: [] });
  mockBrowserPageErrors.mockResolvedValue({ ok: true, targetId: 'page-1', errors: [] });
  mockBrowserNetworkRequests.mockResolvedValue({ ok: true, targetId: 'page-1', requests: [] });
  mockBrowserSetCookies.mockResolvedValue({ ok: true });
  mockBrowserClearCookies.mockResolvedValue({ ok: true });
  mockBrowserGetCookies.mockResolvedValue({ ok: true, targetId: 'page-1', cookies: [] });
  mockBrowserStorageGet.mockResolvedValue({ ok: true, targetId: 'page-1', values: {} });
  mockBrowserStorageSet.mockResolvedValue({ ok: true });
  mockBrowserStorageClear.mockResolvedValue({ ok: true });
  mockBrowserSessionStatus.mockResolvedValue({
    ok: true,
    sessionId: 'browser-session-1',
    status: 'active',
  });
  mockBrowserUpload.mockResolvedValue({
    ok: true,
    targetId: 'page-1',
    filename: 'file.txt',
    size: 4,
  });
  mockBrowserDownload.mockResolvedValue({ ok: true, targetId: 'page-1', downloads: [] });
  mockBrowserPdf.mockResolvedValue({
    ok: true,
    targetId: 'page-1',
    base64: 'AAAA',
    pages: 1,
    size: 32,
  });
  mockBrowserFillForm.mockResolvedValue({ ok: true, targetId: 'page-1' });
  mockBrowserDialog.mockResolvedValue({
    ok: true,
    targetId: 'page-1',
    dialogType: 'alert',
    message: 'Hi',
    handled: true,
  });

  return harness;
}

export function setToolPermissionAllowed(allowed: boolean) {
  mockIsAllowed = allowed;
}
