// ---------------------------------------------------------------------------
// Tests — Enhanced SSH Exec (background, CWD persistence, timeout)
// ---------------------------------------------------------------------------

let mockAsyncStorageData: Record<string, string> = {};
const mockGetBackgroundJob = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorageData[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStorageData[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockAsyncStorageData[key];
  }),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  executeSshCommand: jest.fn().mockResolvedValue('command output'),
  listSshDirectory: jest.fn().mockResolvedValue([]),
  readSshTextFile: jest.fn().mockResolvedValue(''),
  writeSshTextFile: jest.fn().mockResolvedValue(undefined),
  deleteSshPath: jest.fn().mockResolvedValue(undefined),
  makeSshDirectory: jest.fn().mockResolvedValue(undefined),
  renameSshPath: jest.fn().mockResolvedValue(undefined),
  resolveSshTarget: jest.fn().mockResolvedValue({
    id: 't1',
    name: 'Test',
    host: 'test.local',
    port: 22,
    username: 'user',
    remoteRoot: '/home/user',
  }),
}));

jest.mock('../../src/services/remote/store', () => ({
  useRemoteStore: {
    getState: jest.fn().mockReturnValue({
      targets: {},
    }),
  },
  getRemoteSessionRuntime: jest.fn(),
}));

jest.mock('../../src/engine/tools/enhancedExec', () => ({
  enhancedExec: jest
    .fn()
    .mockResolvedValue(JSON.stringify({ status: 'background', jobId: 'bg-1' })),
  getBackgroundJob: (...args: any[]) => mockGetBackgroundJob(...args),
}));

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => 'test-id'),
}));

// Mock canvas-related imports
jest.mock('../../src/services/canvas/renderer', () => ({
  processCanvasMessage: jest.fn(),
  getSurface: jest.fn(),
  getAllSurfaces: jest.fn().mockReturnValue([]),
  requestCanvasEval: jest.fn().mockResolvedValue(''),
  requestCanvasSnapshot: jest.fn().mockResolvedValue(''),
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  spawnSubAgent: jest.fn().mockResolvedValue({
    status: 'completed',
    sessionId: 's1',
    output: '',
    toolsUsed: [],
    iterations: 0,
  }),
  launchSubAgent: jest.fn().mockResolvedValue({ status: 'running', sessionId: 's1', depth: 1 }),
  listActiveSubAgents: jest.fn().mockReturnValue([]),
  getSubAgent: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  CameraType: { front: 'front', back: 'back' },
}));

jest.mock('../../src/services/voice/voice', () => ({
  startRecording: jest.fn(),
  stopRecording: jest.fn().mockResolvedValue(''),
  transcribeAudio: jest.fn().mockResolvedValue({ text: '', language: 'en', duration: 0 }),
  speakText: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/memory/store', () => ({
  searchMemory: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/memory/embeddings', () => ({
  hybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/agents/personas', () => ({
  BUILT_IN_PERSONAS: [],
}));

jest.mock('../../src/services/agents/registry', () => ({
  getAvailablePersonasForConfig: jest.fn().mockReturnValue([]),
  getAvailablePersonas: jest.fn().mockReturnValue([]),
  getPersona: jest.fn(),
  isBuiltInPersona: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/agents/store', () => ({
  usePersonaConfigStore: { getState: jest.fn().mockReturnValue({}) },
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: { getState: jest.fn().mockReturnValue({}) },
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: { getState: jest.fn().mockReturnValue({}) },
}));

jest.mock('../../src/engine/tools/definitions', () => ({
  TOOL_DEFINITIONS: [],
}));

jest.mock('../../src/services/expo/eas', () => ({
  getExpoProjectExecutionMode: jest.fn(),
  getExpoProjectDisplayOwner: jest.fn(),
  getExpoProjectReadiness: jest.fn(),
  getExpoProjectReadinessLabel: jest.fn(),
  listExpoProjects: jest.fn(),
  probeExpoProject: jest.fn(),
  resolveExpoAccount: jest.fn(),
  resolveExpoProject: jest.fn(),
  runExpoProjectAction: jest.fn(),
}));

import {
  executeSshExec,
  executeSshBackgroundJobStatus,
  executeSshBackgroundJobWait,
  executeSshListDirectory,
  executeSshReadFile,
  getLastWorkingDirectory,
} from '../../src/engine/tools/parity-executor';
import { enhancedExec } from '../../src/engine/tools/enhancedExec';
import AsyncStorage from '@react-native-async-storage/async-storage';

beforeEach(() => {
  jest.clearAllMocks();
  mockAsyncStorageData = {};
  mockGetBackgroundJob.mockReset();
});

describe('executeSshExec', () => {
  it('delegates to enhancedExec when background=true', async () => {
    const result = await executeSshExec({
      command: 'npm run build',
      background: true,
    });

    expect(enhancedExec).toHaveBeenCalledWith(
      'npm run build',
      expect.objectContaining({
        background: true,
      }),
    );

    expect(result).toContain('background');
  });

  it('delegates to enhancedExec when timeoutMs is provided', async () => {
    const result = await executeSshExec({
      command: 'long-running-task',
      timeoutMs: 30000,
    });

    expect(enhancedExec).toHaveBeenCalledWith(
      'long-running-task',
      expect.objectContaining({
        timeoutMs: 30000,
      }),
    );
  });

  it('uses regular SSH when no background/timeout', async () => {
    const result = await executeSshExec({
      command: 'ls -la',
      targetId: 't1',
    });

    expect(enhancedExec).not.toHaveBeenCalled();
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('executed');
    expect(parsed.command).toBe('ls -la');
  });

  it('summarizes error-heavy SSH command output', async () => {
    const { executeSshCommand } = require('../../src/services/ssh/connector');
    executeSshCommand.mockResolvedValueOnce(
      [
        'npm notice using package-lock.json',
        'npm ERR! code E404',
        'npm ERR! 404 @kavi/private-package not found',
        'npm ERR! A complete log of this run can be found in /tmp/npm-debug.log',
        ...Array.from({ length: 120 }, (_, index) => `noise line ${index}`),
      ].join('\n'),
    );

    const result = await executeSshExec({
      command: 'npm install',
      targetId: 't1',
    });
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('executed');
    expect(parsed.summary).toContain('error-like output');
    expect(parsed.outputExcerpt).toContain('@kavi/private-package not found');
    expect(parsed.output).toBeUndefined();
  });
});

describe('executeSshListDirectory', () => {
  it('caps long directory listings and reports omitted entries', async () => {
    const { listSshDirectory } = require('../../src/services/ssh/connector');
    listSshDirectory.mockResolvedValueOnce(
      Array.from({ length: 45 }, (_, index) => ({
        filename: `file-${index}.txt`,
        isDirectory: false,
        fileSize: index + 1,
        modificationDate: 1710000000 + index,
      })),
    );

    const result = await executeSshListDirectory({ targetId: 't1', path: '/home/user/project' });
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('listed');
    expect(parsed.count).toBe(45);
    expect(parsed.entries).toHaveLength(40);
    expect(parsed.omittedEntries).toBe(5);
  });
});

describe('SSH background monitoring tools', () => {
  it('returns the current background job snapshot', async () => {
    mockGetBackgroundJob.mockReturnValueOnce({
      status: 'running',
      command: 'npm run build',
      targetId: 't1',
      startedAt: 1710000000000,
      output: 'Step 1\nStep 2',
    });

    const result = await executeSshBackgroundJobStatus({ jobId: 'bg-1' });
    const parsed = JSON.parse(result);

    expect(parsed.jobId).toBe('bg-1');
    expect(parsed.status).toBe('running');
    expect(parsed.outputExcerpt).toContain('Step 1');
    expect(parsed.guidance).toContain('ssh_background_job_wait');
  });

  it('waits for a running background job to complete', async () => {
    jest.useFakeTimers();

    mockGetBackgroundJob
      .mockReturnValueOnce({
        status: 'running',
        command: 'npm run build',
        targetId: 't1',
        startedAt: 1710000000000,
        output: 'Building...',
      })
      .mockReturnValueOnce({
        status: 'completed',
        command: 'npm run build',
        targetId: 't1',
        startedAt: 1710000000000,
        output: 'Done',
      });

    const waitPromise = executeSshBackgroundJobWait({
      jobId: 'bg-1',
      timeoutMs: 200,
      pollIntervalMs: 100,
    });

    await jest.advanceTimersByTimeAsync(100);
    const result = await waitPromise;
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('completed');
    expect(parsed.summary).toContain('completed');
    expect(mockGetBackgroundJob).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});

describe('executeSshReadFile', () => {
  it('trims oversized remote files to an excerpt', async () => {
    const { readSshTextFile } = require('../../src/services/ssh/connector');
    const largeContent = `first line\n${'x'.repeat(14000)}\nlast line`;
    readSshTextFile.mockResolvedValueOnce(largeContent);

    const result = await executeSshReadFile({
      targetId: 't1',
      path: '/home/user/project/build.log',
    });
    const parsed = JSON.parse(result);

    expect(parsed.status).toBe('read');
    expect(parsed.content).toBeUndefined();
    expect(parsed.contentExcerpt).toContain('first line');
    expect(parsed.contentExcerpt).toContain('last line');
    expect(parsed.truncated).toBe(true);
  });
});

describe('CWD persistence', () => {
  it('persists cwd when provided', async () => {
    await executeSshExec({
      command: 'pwd',
      targetId: 't1',
      cwd: '/home/user/project',
    });

    // Wait for async persistence
    await new Promise((r) => setTimeout(r, 50));

    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  it('serializes concurrent cwd persistence so multiple targets are not clobbered', async () => {
    const { resolveSshTarget } = require('../../src/services/ssh/connector');
    resolveSshTarget.mockImplementation(async (targetId?: string) => ({
      id: targetId || 't1',
      name: 'Test',
      host: 'test.local',
      port: 22,
      username: 'user',
      remoteRoot: '/home/user',
    }));

    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return mockAsyncStorageData[key] ?? null;
    });
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      mockAsyncStorageData[key] = value;
    });

    await Promise.all([
      executeSshExec({
        command: 'pwd',
        targetId: 't1',
        cwd: '/srv/app',
      }),
      executeSshExec({
        command: 'pwd',
        targetId: 't2',
        cwd: '/srv/worker',
      }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(JSON.parse(mockAsyncStorageData['kavi-ssh-cwd'])).toEqual({
      t1: '/srv/app',
      t2: '/srv/worker',
    });
  });

  it('getLastWorkingDirectory returns null when not set', async () => {
    const cwd = await getLastWorkingDirectory('t1');
    expect(cwd).toBeNull();
  });

  it('getLastWorkingDirectory returns persisted value', async () => {
    mockAsyncStorageData['kavi-ssh-cwd'] = JSON.stringify({
      t1: '/home/user/project',
    });

    const cwd = await getLastWorkingDirectory('t1');
    expect(cwd).toBe('/home/user/project');
  });

  it('getLastWorkingDirectory returns null for unknown target', async () => {
    mockAsyncStorageData['kavi-ssh-cwd'] = JSON.stringify({
      t1: '/home/user/project',
    });

    const cwd = await getLastWorkingDirectory('unknown');
    expect(cwd).toBeNull();
  });
});

describe('SSH_EXEC_TOOL definition', () => {
  it('includes background and timeoutMs properties', () => {
    // Import the definition to verify schema
    const { SSH_EXEC_TOOL } = require('../../src/engine/tools/parity-definitions');
    expect(SSH_EXEC_TOOL.input_schema.properties).toHaveProperty('background');
    expect(SSH_EXEC_TOOL.input_schema.properties.background.type).toBe('boolean');
    expect(SSH_EXEC_TOOL.input_schema.properties).toHaveProperty('timeoutMs');
    expect(SSH_EXEC_TOOL.input_schema.properties.timeoutMs.type).toBe('number');
    expect(SSH_EXEC_TOOL.description).toContain('ssh_background_job_status');
  });

  it('exports SSH background monitor tool schemas', () => {
    const {
      SSH_BACKGROUND_JOB_STATUS_TOOL,
      SSH_BACKGROUND_JOB_WAIT_TOOL,
    } = require('../../src/engine/tools/parity-definitions');
    expect(SSH_BACKGROUND_JOB_STATUS_TOOL.input_schema.required).toEqual(['jobId']);
    expect(SSH_BACKGROUND_JOB_WAIT_TOOL.input_schema.required).toEqual(['jobId']);
    expect(SSH_BACKGROUND_JOB_WAIT_TOOL.input_schema.properties).toHaveProperty('pollIntervalMs');
  });
});
