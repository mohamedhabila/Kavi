// ---------------------------------------------------------------------------
// Tests — Tool Executor Dispatcher (builtin tools routing in index.ts)
// ---------------------------------------------------------------------------

// Mock expo-file-system
jest.mock('expo-file-system', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const store: Record<string, Uint8Array> = {};
  const dirs = new Set<string>();

  const normalizeUri = (value: string): string => value.replace(/\/+$/g, '');

  const joinUri = (...parts: string[]): string => {
    if (parts.length === 0) return '';
    let result = parts[0] || '';
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index] || '';
      result = `${normalizeUri(result)}/${part.replace(/^\/+/, '')}`;
    }
    return normalizeUri(result);
  };

  const ensureParents = (uri: string) => {
    const normalized = normalizeUri(uri);
    const pieces = normalized.split('/');
    for (let index = 3; index < pieces.length; index += 1) {
      const dirUri = pieces.slice(0, index).join('/');
      if (dirUri) {
        dirs.add(dirUri);
      }
    }
  };

  class MockFile {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }
      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get exists() {
      return this.uri in store;
    }

    text() {
      return decoder.decode(store[this.uri] || new Uint8Array());
    }

    bytes() {
      return store[this.uri] || new Uint8Array();
    }

    write(content: string | Uint8Array | ArrayBuffer) {
      ensureParents(this.uri);
      if (typeof content === 'string') {
        store[this.uri] = encoder.encode(content);
        return;
      }
      if (content instanceof Uint8Array) {
        store[this.uri] = content;
        return;
      }
      store[this.uri] = new Uint8Array(content);
    }

    delete() {
      delete store[this.uri];
    }
  }

  class MockDirectory {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }
      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get exists() {
      return dirs.has(this.uri);
    }

    create() {
      ensureParents(this.uri);
      dirs.add(this.uri);
    }

    list() {
      const prefix = this.uri.endsWith('/') ? this.uri : `${this.uri}/`;
      const results: any[] = [];
      const seen = new Set<string>();

      for (const dir of Array.from(dirs)) {
        if (!dir.startsWith(prefix) || dir === this.uri) {
          continue;
        }
        const rest = dir.slice(prefix.length);
        const firstPart = rest.split('/')[0];
        if (!firstPart || seen.has(firstPart)) {
          continue;
        }
        seen.add(firstPart);
        results.push(new MockDirectory(this, firstPart));
      }

      for (const uri of Object.keys(store)) {
        if (!uri.startsWith(prefix)) {
          continue;
        }
        const rest = uri.slice(prefix.length);
        const firstPart = rest.split('/')[0];
        if (!firstPart || seen.has(firstPart)) {
          continue;
        }
        seen.add(firstPart);
        if (rest.includes('/')) {
          results.push(new MockDirectory(this, firstPart));
        } else {
          results.push(new MockFile(this, firstPart));
        }
      }

      return results;
    }
  }

  const documentRoot = 'file:///mock/documents';
  const cacheRoot = 'file:///mock/cache';
  dirs.add(documentRoot);
  dirs.add(cacheRoot);

  return {
    Paths: {
      get document() {
        return new MockDirectory(documentRoot);
      },
      get cache() {
        return new MockDirectory(cacheRoot);
      },
    },
    File: MockFile,
    Directory: MockDirectory,
    __resetStore: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
      dirs.clear();
      dirs.add(documentRoot);
      dirs.add(cacheRoot);
    },
  };
});

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

let executeTool: ExecuteToolFn;
let builtinMod: BuiltinToolModule;
let sessionLaunchMod: SessionLaunchModule;
let sessionInspectionMod: SessionInspectionModule;
let executeNativeTool: jest.Mock;
let generateImage: jest.Mock;
let editImage: jest.Mock;
let memoryStore: MemoryStoreModule;
let resetExpoFileStore: () => void;

function loadTestModules() {
  ({ executeTool } = require('../../src/engine/tools/index'));
  builtinMod = mockBuiltinToolFns;
  sessionLaunchMod = mockSessionLaunchFns;
  sessionInspectionMod = mockSessionInspectionFns;
  ({ executeNativeTool } = require('../../src/engine/tools/native/executor'));
  ({ generateImage, editImage } = require('../../src/services/media/imageGeneration'));
  memoryStore = require('../../src/services/memory/store') as MemoryStoreModule;
  ({ __resetStore: resetExpoFileStore } = require('expo-file-system'));
}

const CONV_ID = 'test-conv-123';

beforeEach(() => {
  jest.resetModules();
  loadTestModules();
  resetExpoFileStore();
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
});

describe('executeTool — builtin routing', () => {
  const builtinTools: Array<
    [string, string, 'builtin' | 'session', keyof BuiltinToolModule | keyof SessionInspectionModule]
  > = [
    ['canvas_list', '{}', 'builtin', 'executeCanvasList'],
    ['canvas_read', '{}', 'builtin', 'executeCanvasRead'],
    ['canvas_create', '{"surface":"test"}', 'builtin', 'executeCanvasCreate'],
    ['canvas_update', '{"surface":"test"}', 'builtin', 'executeCanvasUpdate'],
    ['canvas_delete', '{"surface":"test"}', 'builtin', 'executeCanvasDelete'],
    ['canvas_navigate', '{"surface":"test"}', 'builtin', 'executeCanvasNavigate'],
    ['canvas_eval', '{"surface":"test"}', 'builtin', 'executeCanvasEval'],
    ['canvas_snapshot', '{}', 'builtin', 'executeCanvasSnapshot'],
    ['sessions_list', '{}', 'session', 'executeSessionList'],
    ['sessions_history', '{"sessionId":"s1"}', 'session', 'executeSessionHistory'],
    ['sessions_output', '{"sessionId":"s1"}', 'session', 'executeSessionOutput'],
    ['sessions_surface_output', '{"sessionId":"s1"}', 'session', 'executeSessionSurfaceOutput'],
    ['sessions_status', '{"sessionId":"s1"}', 'session', 'executeSessionStatus'],
    ['sessions_wait', '{"sessionId":"s1"}', 'session', 'executeSessionWait'],
    ['sessions_cancel', '{"sessionId":"s1"}', 'session', 'executeSessionCancel'],
    ['wait', '{"ms":100}', 'builtin', 'executeWait'],
    ['pdf_read', '{"path":"test.pdf"}', 'builtin', 'executePdfRead'],
    ['camera_snap', '{}', 'builtin', 'executeCameraSnap'],
    ['audio_transcribe', '{}', 'builtin', 'executeAudioTranscribe'],
    ['memory_search', '{"query":"test"}', 'builtin', 'executeMemorySearch'],
    ['ssh_exec', '{"command":"pwd"}', 'builtin', 'executeSshExec'],
    ['ssh_background_job_status', '{"jobId":"bg-1"}', 'builtin', 'executeSshBackgroundJobStatus'],
    ['ssh_background_job_wait', '{"jobId":"bg-1"}', 'builtin', 'executeSshBackgroundJobWait'],
    ['ssh_list_directory', '{}', 'builtin', 'executeSshListDirectory'],
    ['ssh_read_file', '{"path":"README.md"}', 'builtin', 'executeSshReadFile'],
    ['ssh_write_file', '{"path":"README.md","content":"hello"}', 'builtin', 'executeSshWriteFile'],
    ['ssh_rename_path', '{"oldPath":"a","newPath":"b"}', 'builtin', 'executeSshRenamePath'],
    ['ssh_delete_path', '{"path":"a"}', 'builtin', 'executeSshDeletePath'],
    ['ssh_make_directory', '{"path":"tmp"}', 'builtin', 'executeSshMakeDirectory'],
    ['expo_eas_create_project', '{"name":"Expo App"}', 'builtin', 'executeExpoEasCreateProject'],
    ['expo_eas_status', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasStatus'],
    ['expo_eas_probe', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasProbe'],
    ['expo_eas_build', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasBuild'],
    ['expo_eas_update', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasUpdate'],
    ['expo_eas_submit', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasSubmit'],
    ['expo_eas_deploy_web', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasDeployWeb'],
    ['expo_eas_workflow_runs', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasWorkflowRuns'],
    [
      'expo_eas_workflow_status',
      '{"projectId":"expo-1"}',
      'builtin',
      'executeExpoEasWorkflowStatus',
    ],
    ['expo_eas_workflow_wait', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasWorkflowWait'],
    ['expo_eas_graphql', '{"query":"query { __typename }"}', 'builtin', 'executeExpoEasGraphql'],
    ['tool_catalog', '{}', 'builtin', 'executeToolCatalog'],
    ['tool_describe', '{"name":"read_file"}', 'builtin', 'executeToolDescribe'],
    ['poll_create', '{"question":"Pick one","options":["A","B"]}', 'builtin', 'executePollCreate'],
    ['speak', '{"text":"hello"}', 'builtin', 'executeSpeak'],
    ['agents_list', '{}', 'builtin', 'executeAgentsList'],
    ['agents_switch', '{"personaId":"p1"}', 'builtin', 'executeAgentsSwitch'],
    ['agents_configure', '{"name":"test"}', 'builtin', 'executeAgentsConfigure'],
  ];

  it.each(builtinTools)('routes %s', async (toolName, args, moduleName, fnName) => {
    await executeTool(toolName, args, CONV_ID);
    const moduleUnderTest = moduleName === 'session' ? sessionInspectionMod : builtinMod;
    expect(moduleUnderTest[fnName as keyof typeof moduleUnderTest]).toHaveBeenCalled();
  });

  it('passes the current callable tool inventory into tool_catalog', async () => {
    await executeTool('tool_catalog', '{}', CONV_ID, {
      availableToolNames: ['tool_catalog', 'read_file', 'mcp__docs__search_docs'],
    });

    expect(builtinMod.executeToolCatalog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        availableToolNames: new Set(['tool_catalog', 'read_file', 'mcp__docs__search_docs']),
      }),
    );
  });

  it('passes conversation file context to canvas html tools', async () => {
    await executeTool('canvas_create', '{"filePath":"canvas/preview.html"}', CONV_ID);

    expect(builtinMod.executeCanvasCreate).toHaveBeenCalledWith(
      { filePath: 'canvas/preview.html' },
      expect.objectContaining({
        conversationId: CONV_ID,
        readConversationFile: expect.any(Function),
        listConversationDirectory: expect.any(Function),
      }),
    );
  });
});

describe('executeTool — core tools routing', () => {
  it('routes memory_search with the shared conversation scope', async () => {
    const result = await executeTool('memory_search', '{"query":"state"}', CONV_ID);

    expect(result).toBe(JSON.stringify({ status: 'ok' }));
    expect(builtinMod.executeMemorySearch).toHaveBeenCalledWith(
      { query: 'state' },
      {
        provider: 'openai',
        apiKey: 'sk-image',
        baseUrl: 'https://api.openai.com/v1',
      },
      { conversationId: CONV_ID },
    );
    expect(memoryStore.searchMemory).not.toHaveBeenCalledWith('state', {
      scope: 'all',
      conversationId: CONV_ID,
    });
  });

  it('normalizes python file output without store evidence writes', async () => {
    mockExecutePython.mockResolvedValueOnce({
      success: true,
      output: 'analysis complete',
      files: [{ path: 'reports/analysis.json', contentBase64: 'e30=' }],
    });

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'print("analysis")' }),
      CONV_ID,
      {
        workspaceConversationId: CONV_ID,
      },
    );

    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print("analysis")',
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();

    expect(JSON.parse(result)).toEqual(
      expect.objectContaining({
        status: 'completed',
        fileCount: 1,
      }),
    );
  });

  it('handles invalid JSON args gracefully', async () => {
    const result = await executeTool('read_file', '{invalid json', CONV_ID);
    // Robust arg parsing falls back to {} — tool runs with no args
    expect(typeof result).toBe('string');
  });

  it('routes cron create', async () => {
    const result = await executeTool(
      'cron',
      '{"action":"create","schedule":"0 * * * *","prompt":"test"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('task_created');
  });

  it('routes cron list', async () => {
    const result = await executeTool('cron', '{"action":"list"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.jobs).toEqual([]);
  });

  it('routes cron delete', async () => {
    const result = await executeTool('cron', '{"action":"delete","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('deleted');
  });

  it('routes cron enable', async () => {
    const result = await executeTool('cron', '{"action":"enable","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('enabled');
  });

  it('routes cron disable', async () => {
    const result = await executeTool('cron', '{"action":"disable","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('disabled');
  });

  it('routes cron run', async () => {
    mockGetJob.mockReturnValue({ name: 'test job' });
    const result = await executeTool('cron', '{"action":"run","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('triggered');
  });

  it('handles cron unknown action', async () => {
    const result = await executeTool('cron', '{"action":"bogus"}', CONV_ID);
    expect(result).toContain('unknown cron action');
  });

  it('routes notify', async () => {
    const result = await executeTool('notification_send', '{"title":"hi","body":"there"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('notification_displayed');
    expect(executeNativeTool).toHaveBeenCalledWith(
      'notification_send',
      '{"title":"hi","body":"there"}',
    );
  });

  it('routes image_generate', async () => {
    const result = await executeTool('image_generate', '{"prompt":"cat"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('generated');
    expect(parsed.fileUri).toBe('file:///mock/cache/generated.png');
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      { prompt: 'cat', conversationId: CONV_ID },
    );
  });

  it('handles image_generate failure gracefully', async () => {
    (generateImage as jest.Mock).mockRejectedValueOnce(
      new Error('Anthropic does not support image generation'),
    );
    const result = await executeTool('image_generate', '{"prompt":"cat"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('error');
    expect(parsed.message).toContain('Anthropic');
  });

  it('routes image_edit', async () => {
    const result = await executeTool(
      'image_edit',
      '{"prompt":"Add a teal scarf","imagePath":"assets/cat.png"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('edited');
    expect(parsed.fileUri).toBe('file:///mock/cache/edited.png');
    expect(editImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      expect.objectContaining({
        prompt: 'Add a teal scarf',
        conversationId: CONV_ID,
        images: [
          expect.objectContaining({
            uri: 'file:///mock/documents/workspace/test-conv-123/assets/cat.png',
          }),
        ],
      }),
    );
  });

  it('handles image_edit failure gracefully', async () => {
    (editImage as jest.Mock).mockRejectedValueOnce(
      new Error('Image editing requires at least one input image'),
    );
    const result = await executeTool(
      'image_edit',
      '{"prompt":"Add a teal scarf","imagePath":"assets/cat.png"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('error');
    expect(parsed.message).toContain('requires at least one input image');
  });

  it('sessions_spawn passes resolved provider', async () => {
    await executeTool('sessions_spawn', '{"prompt":"hello"}', CONV_ID);
    expect(sessionLaunchMod.executeSessionSpawn).toHaveBeenCalledWith(
      { prompt: 'hello' },
      CONV_ID,
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      expect.any(Array),
      'gpt-image-2',
      {
        controlGraphGoals: undefined,
        agentRunId: undefined,
      },
    );
  });

  it('sessions_send passes resolved provider', async () => {
    await executeTool('sessions_send', '{"sessionId":"s1","message":"hi"}', CONV_ID);
    expect(sessionLaunchMod.executeSessionSend).toHaveBeenCalledWith(
      { sessionId: 's1', message: 'hi' },
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      undefined,
    );
  });

  it('sessions_spawn passes the parent runtime model instead of the provider default', async () => {
    await executeTool('sessions_spawn', '{"prompt":"hello"}', CONV_ID, {
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-parent',
        model: 'claude-default',
        enabled: true,
      },
      allProviders: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-parent',
          model: 'claude-default',
          enabled: true,
        },
      ],
      model: 'claude-3-7-sonnet-20250219',
    });

    expect(sessionLaunchMod.executeSessionSpawn).toHaveBeenCalledWith(
      { prompt: 'hello' },
      CONV_ID,
      expect.objectContaining({
        id: 'anthropic',
        model: 'claude-3-7-sonnet-20250219',
      }),
      expect.arrayContaining([
        expect.objectContaining({
          id: 'anthropic',
          model: 'claude-3-7-sonnet-20250219',
        }),
      ]),
      'claude-3-7-sonnet-20250219',
      {
        controlGraphGoals: undefined,
        agentRunId: undefined,
      },
    );
  });

  it('sessions_send passes the parent runtime model instead of the provider default', async () => {
    await executeTool('sessions_send', '{"sessionId":"s1","message":"hi"}', CONV_ID, {
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-parent',
        model: 'claude-default',
        enabled: true,
      },
      model: 'claude-3-7-sonnet-20250219',
    });

    expect(sessionLaunchMod.executeSessionSend).toHaveBeenCalledWith(
      { sessionId: 's1', message: 'hi' },
      expect.objectContaining({
        id: 'anthropic',
        model: 'claude-3-7-sonnet-20250219',
      }),
      'claude-3-7-sonnet-20250219',
    );
  });

  it('returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', '{}', CONV_ID);
    expect(result).toContain('unknown tool');
  });

  it('routes javascript', async () => {
    const result = await executeTool('javascript', '{"code":"return 42"}', CONV_ID);
    expect(result).toBe('42');
  });

  it('routes python through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","packages":["numpy"]}',
      CONV_ID,
    );
    expect(result).toBe('42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        packages: ['numpy'],
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();
  });

  it('routes python timeout overrides through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","timeoutMs":120000}',
      CONV_ID,
    );
    expect(result).toBe('42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        timeoutMs: 120000,
      }),
    );
  });

  it('routes python custom package indexes through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","packages":["requests"],"indexUrls":["https://packages.example/simple"]}',
      CONV_ID,
    );

    expect(result).toBe('42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        packages: ['requests'],
        indexUrls: ['https://packages.example/simple'],
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();
  });

  it('routes workspace_status and summarizes configured targets', async () => {
    const result = await executeTool('workspace_status', '{}', CONV_ID);

    expect(JSON.parse(result)).toMatchObject({
      summary: 'Found 1 configured workspace targets.',
      targets: [expect.objectContaining({ targetId: 'ws-1', summary: 'Workspace A is ready.' })],
    });
    expect(mockGetWorkspaceTargetControlStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws-1' }),
      expect.objectContaining({
        workspaceTargets: expect.any(Array),
      }),
    );
  });

  it('routes workspace_launch_browser with validated args', async () => {
    const result = await executeTool(
      'workspace_launch_browser',
      '{"targetId":"ws-1","providerId":"browser-1"}',
      CONV_ID,
    );

    expect(JSON.parse(result)).toMatchObject({
      summary: 'Workspace browser session launched for Workspace A.',
      targetId: 'ws-1',
      sessionId: 'workspace-browser-session-1',
      providerId: 'browser-1',
      url: 'https://workspace.example.com',
    });
    expect(mockLaunchWorkspaceBrowserSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws-1' }),
      expect.objectContaining({ providerId: 'browser-1' }),
    );
  });

  it('returns a friendly error when workspace_delegate_task prompt is missing', async () => {
    const result = await executeTool('workspace_delegate_task', '{"targetId":"ws-1"}', CONV_ID);

    expect(result).toContain('Error');
    expect(result).toContain('prompt');
    expect(mockDelegateWorkspaceTask).not.toHaveBeenCalled();
  });

  it('summarizes browser screenshots without returning base64 blobs', async () => {
    mockBrowserScreenshot.mockResolvedValueOnce({
      ok: true,
      targetId: 'page-2',
      url: 'https://example.com/app',
      imageBase64: 'A'.repeat(12000),
    });

    const result = await executeTool(
      'browser_screenshot',
      '{"sessionId":"browser-session-1"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary).toContain('Binary image omitted');
    expect(parsed.targetId).toBe('page-2');
    expect(parsed.imageBase64).toBeUndefined();
    expect(parsed.imageBytes).toBeGreaterThan(0);
  });

  it('keeps browser snapshots inspectable while trimming oversized page state', async () => {
    const largeSnapshot = `Hero heading\n${'Content line\n'.repeat(3000)}Footer note`;
    mockBrowserSnapshot.mockResolvedValueOnce({
      ok: true,
      targetId: 'page-3',
      snapshot: largeSnapshot,
      truncated: false,
    });

    const result = await executeTool(
      'browser_snapshot',
      '{"sessionId":"browser-session-1"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary).toContain('trimmed for context');
    expect(parsed.snapshotChars).toBe(largeSnapshot.length);
    expect(parsed.snapshot).toContain('Hero heading');
    expect(parsed.snapshot).toContain('Footer note');
    expect(parsed.truncated).toBe(true);
  });

  it('prioritizes failing browser network requests in summarized results', async () => {
    mockBrowserNetworkRequests.mockResolvedValueOnce({
      ok: true,
      targetId: 'page-4',
      requests: [
        { method: 'GET', url: 'https://example.com/ok', status: 200, resourceType: 'document' },
        { method: 'GET', url: 'https://example.com/fail', status: 502, resourceType: 'xhr' },
        {
          method: 'POST',
          url: 'https://example.com/also-fail',
          status: 500,
          resourceType: 'fetch',
        },
      ],
    });

    const result = await executeTool(
      'browser_network',
      '{"sessionId":"browser-session-1"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.failedCount).toBe(2);
    expect(parsed.requests[0].status).toBeGreaterThanOrEqual(400);
  });

  it('routes workspace_delegate_task and returns the delegated output preview', async () => {
    const result = await executeTool(
      'workspace_delegate_task',
      '{"targetId":"ws-1","prompt":"Investigate build failures","mode":"agent"}',
      CONV_ID,
    );

    expect(JSON.parse(result)).toMatchObject({
      summary: 'Delegated task to Workspace A via Cursor CLI.',
      targetId: 'ws-1',
      sshTargetId: 'ssh-1',
      mode: 'agent',
      output: 'Delegated task completed successfully.',
      truncated: false,
    });
    expect(mockDelegateWorkspaceTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws-1' }),
      'Investigate build failures',
      expect.objectContaining({ mode: 'agent' }),
    );
  });
});

describe('executeTool — permission check', () => {
  it('blocks denied tools', async () => {
    mockIsAllowed = false;
    const result = await executeTool('read_file', '{"path":"test"}', CONV_ID);
    expect(result).toContain('not allowed');
  });
});
