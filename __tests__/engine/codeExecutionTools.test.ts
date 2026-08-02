import { executePython } from '../../src/services/python/pyodideBridge';
import { executeJavascript } from '../../src/engine/tools/toolJavaScriptExecution';
import { executePythonTool } from '../../src/engine/tools/toolPythonExecution';
import {
  persistJavaScriptWorkspaceChanges,
  persistPythonWorkspaceFiles,
  prepareJavaScriptWorkspaceExecution,
  preparePythonWorkspaceExecution,
} from '../../src/engine/tools/toolWorkspaceSnapshots';
import { parseCompletedToolOutcome, parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';

jest.mock('../../src/services/python/pyodideBridge', () => ({
  executePython: jest.fn(),
}));

jest.mock('../../src/engine/tools/toolWorkspaceSnapshots', () => ({
  prepareJavaScriptWorkspaceExecution: jest.fn(),
  persistJavaScriptWorkspaceChanges: jest.fn(),
  preparePythonWorkspaceExecution: jest.fn(),
  persistPythonWorkspaceFiles: jest.fn(),
}));

const mockedExecutePython = jest.mocked(executePython);
const mockedPrepareJavaScriptWorkspaceExecution = jest.mocked(prepareJavaScriptWorkspaceExecution);
const mockedPersistJavaScriptWorkspaceChanges = jest.mocked(persistJavaScriptWorkspaceChanges);
const mockedPreparePythonWorkspaceExecution = jest.mocked(preparePythonWorkspaceExecution);
const mockedPersistPythonWorkspaceFiles = jest.mocked(persistPythonWorkspaceFiles);

describe('code execution tools', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedPrepareJavaScriptWorkspaceExecution.mockResolvedValue([]);
    mockedPreparePythonWorkspaceExecution.mockResolvedValue({ files: [], packages: [] });
  });

  it('returns a structured JavaScript completion contract', async () => {
    const result = await executeJavascript({ code: 'return 2 + 2;' }, 'conversation-1');

    expect(parseCompletedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'completed',
        workspaceMutationState: 'none_observed',
        output: '4',
      }),
    );
  });

  it('returns a structured JavaScript failure even when logs precede the error', async () => {
    const result = await executeJavascript(
      { code: 'console.log("started"); throw new Error("boom");' },
      'conversation-1',
    );

    expect(parseFailedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'failed',
        isError: true,
        workspaceMutationState: 'none_observed',
        error: expect.stringContaining('boom'),
      }),
    );
  });

  it('reports and persists JavaScript workspace mutations after successful execution', async () => {
    const result = await executeJavascript(
      { code: 'fs.writeFile("result.txt", "done");' },
      'conversation-1',
    );

    expect(mockedPersistJavaScriptWorkspaceChanges).toHaveBeenCalledWith(
      'conversation-1',
      [{ path: 'result.txt', content: 'done' }],
      [],
    );
    expect(parseCompletedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'completed',
        workspaceMutationState: 'applied',
        files: [expect.objectContaining({ path: 'result.txt' })],
      }),
    );
  });

  it('preserves JavaScript completion truth when workspace persistence fails', async () => {
    mockedPersistJavaScriptWorkspaceChanges.mockRejectedValueOnce(new Error('storage unavailable'));

    const result = await executeJavascript(
      { code: 'fs.writeFile("result.txt", "done"); return 42;' },
      'conversation-1',
    );

    expect(parseFailedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'effect_failed',
        isError: true,
        failureKind: 'workspace_persistence_failed',
        output: '42',
      }),
    );
  });

  it('returns a structured Python completion contract', async () => {
    mockedExecutePython.mockResolvedValueOnce({
      success: true,
      output: '42',
      networkAccessState: 'blocked',
      networkMutationState: 'none_observed',
      networkRequestCount: 0,
    });

    const result = await executePythonTool({ code: 'print(42)' }, 'conversation-1', 'workspace-1');

    expect(parseCompletedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'completed',
        workspaceMutationState: 'none_observed',
        networkAccessState: 'blocked',
        networkMutationState: 'none_observed',
        networkRequestCount: 0,
        executionEffectState: 'none_observed',
        output: '42',
      }),
    );
    expect(mockedExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({ allowNetwork: false }),
    );
  });

  it('requires explicit Python network authority and verifies an observed safe read', async () => {
    mockedExecutePython.mockResolvedValueOnce({
      success: true,
      output: 'remote data',
      networkAccessState: 'enabled',
      networkMutationState: 'none_observed',
      networkRequestCount: 1,
    });

    const result = await executePythonTool(
      { code: 'await kavi.http.get_text("https://example.com")', allowNetwork: true },
      'conversation-1',
      'workspace-1',
    );

    expect(mockedExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({ allowNetwork: true }),
    );
    expect(parseCompletedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'completed',
        networkAccessState: 'enabled',
        networkMutationState: 'none_observed',
        networkRequestCount: 1,
        executionEffectState: 'none_observed',
      }),
    );
  });

  it('keeps mutation-capable Python network execution unverified', async () => {
    mockedExecutePython.mockResolvedValueOnce({
      success: true,
      output: 'accepted',
      networkAccessState: 'enabled',
      networkMutationState: 'possible',
      networkRequestCount: 1,
    });

    const result = await executePythonTool(
      {
        code: 'await kavi.http.post_json("https://example.com", json={"ok": True})',
        allowNetwork: true,
      },
      'conversation-1',
      'workspace-1',
    );

    expect(parseCompletedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'completed',
        networkMutationState: 'possible',
        executionEffectState: 'unknown',
      }),
    );
  });

  it('rejects non-boolean Python network authority before runtime dispatch', async () => {
    const result = await executePythonTool(
      { code: 'print(42)', allowNetwork: 'yes' as unknown as boolean },
      'conversation-1',
      'workspace-1',
    );

    expect(parseFailedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureKind: 'invalid_request',
        error: expect.stringContaining('allowNetwork'),
      }),
    );
    expect(mockedExecutePython).not.toHaveBeenCalled();
  });

  it('returns structured Python validation and runtime failures', async () => {
    const malformed = await executePythonTool({}, 'conversation-1', 'workspace-1');
    mockedExecutePython.mockResolvedValueOnce({
      success: false,
      output: 'started',
      error: 'ValueError: boom',
      failureKind: 'execution_failed',
    });
    const failed = await executePythonTool(
      { code: 'raise ValueError("boom")' },
      'conversation-1',
      'workspace-1',
    );

    expect(parseFailedToolOutcome(malformed)).toEqual(
      expect.objectContaining({
        status: 'failed',
        isError: true,
        failureKind: 'invalid_request',
      }),
    );
    expect(parseFailedToolOutcome(failed)).toEqual(
      expect.objectContaining({
        status: 'failed',
        isError: true,
        workspaceMutationState: 'none_observed',
        output: 'started',
        error: 'ValueError: boom',
        failureKind: 'execution_failed',
      }),
    );
  });

  it('preserves Python hard-timeout truth from the code-owned bridge contract', async () => {
    mockedExecutePython.mockResolvedValueOnce({
      success: false,
      error: 'Python execution timed out after 1000ms',
      failureKind: 'timed_out',
    });

    const result = await executePythonTool(
      { code: 'while True: pass' },
      'conversation-1',
      'workspace-1',
    );

    expect(parseFailedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'timed_out',
        isError: true,
        failureKind: 'timed_out',
        workspaceMutationState: 'none_observed',
        networkAccessState: 'blocked',
        networkMutationState: 'none_observed',
        executionEffectState: 'none_observed',
      }),
    );
  });

  it('normalizes an unexpected Python bridge throw as a returned execution failure', async () => {
    mockedExecutePython.mockRejectedValueOnce(new Error('bridge crashed'));

    const result = await executePythonTool({ code: 'print(42)' }, 'conversation-1', 'workspace-1');

    expect(parseFailedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'failed',
        isError: true,
        workspaceMutationState: 'none_observed',
        networkAccessState: 'blocked',
        networkMutationState: 'none_observed',
        executionEffectState: 'none_observed',
        error: 'bridge crashed',
        failureKind: 'runtime_failed',
      }),
    );
  });

  it('persists only Python files explicitly returned by the code-owned bridge', async () => {
    const files = [{ path: 'result.txt', contentBase64: 'ZG9uZQ==' }];
    mockedExecutePython.mockResolvedValueOnce({ success: true, output: 'saved', files });

    const result = await executePythonTool(
      { code: 'print("saved")' },
      'conversation-1',
      'workspace-1',
    );

    expect(mockedPersistPythonWorkspaceFiles).toHaveBeenCalledWith('workspace-1', files);
    expect(parseCompletedToolOutcome(result)).toEqual(
      expect.objectContaining({ status: 'completed', workspaceMutationState: 'applied' }),
    );
  });

  it('preserves Python completion truth when workspace persistence fails', async () => {
    mockedPersistPythonWorkspaceFiles.mockRejectedValueOnce(new Error('storage unavailable'));
    mockedExecutePython.mockResolvedValueOnce({
      success: true,
      output: 'computed',
      files: [{ path: 'result.txt', contentBase64: 'ZG9uZQ==' }],
    });

    const result = await executePythonTool({ code: 'print(42)' }, 'conversation-1', 'workspace-1');

    expect(parseFailedToolOutcome(result)).toEqual(
      expect.objectContaining({
        status: 'effect_failed',
        isError: true,
        failureKind: 'workspace_persistence_failed',
        output: 'computed',
      }),
    );
  });
});
