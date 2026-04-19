import {
  buildShellRuntimeCommand,
  extractWorkingDirectoryFromStdout,
  normalizeTermuxCommandResult,
} from '../../../src/services/terminal/localRuntime';

const loadLocalRuntime = (options: {
  os: 'android' | 'ios';
  nativeModule?: {
    getAvailability?: jest.Mock;
    execute?: jest.Mock;
  };
}) => {
  jest.resetModules();
  jest.doMock('react-native', () => ({
    NativeModules: options.nativeModule ? { KaviTermux: options.nativeModule } : {},
    Platform: { OS: options.os },
  }));

  let localRuntime: typeof import('../../../src/services/terminal/localRuntime');
  jest.isolateModules(() => {
    localRuntime = require('../../../src/services/terminal/localRuntime');
  });

  jest.dontMock('react-native');
  return localRuntime!;
};

describe('localRuntime', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native');
  });

  it('wraps shell commands with cwd tracking', () => {
    const command = buildShellRuntimeCommand('npm test', "/tmp/it's-here");

    expect(command).toContain("cd '/tmp/it'\"'\"'s-here' >/dev/null 2>&1 || exit 1");
    expect(command).toContain('npm test');
    expect(command).toContain('__KAVI_CWD__:');
  });

  it('extracts working directory marker from stdout', () => {
    expect(extractWorkingDirectoryFromStdout('hello\n__KAVI_CWD__:/tmp')).toEqual({
      stdout: 'hello',
      workingDirectory: '/tmp',
    });
  });

  it('normalizes termux results into shell results', () => {
    const result = normalizeTermuxCommandResult({
      stdout: 'build ok\n__KAVI_CWD__:/workspace',
      stderr: '',
      exitCode: 0,
      errCode: -1,
      durationMs: 15,
      stdoutOriginalLength: null,
      stderrOriginalLength: null,
    });

    expect(result).toEqual({
      ok: true,
      stdout: 'build ok',
      stderr: '',
      exitCode: 0,
      errCode: -1,
      errorMessage: undefined,
      workingDirectory: '/workspace',
      durationMs: 15,
      stdoutWasTruncated: false,
      stderrWasTruncated: false,
    });
  });

  it('reports iOS as JavaScript-only runtime', async () => {
    const { getLocalRuntimeCapabilities } = loadLocalRuntime({ os: 'ios' });

    await expect(getLocalRuntimeCapabilities()).resolves.toEqual({
      javascriptAvailable: true,
      shellSupported: false,
      shellAvailable: false,
      shellProvider: null,
      unavailableReason:
        'Real local shell is only available on Android in this build. Use JavaScript mode or a remote SSH target.',
    });
  });

  it('reports missing Android bridge availability', async () => {
    const { getLocalRuntimeCapabilities } = loadLocalRuntime({ os: 'android' });

    await expect(getLocalRuntimeCapabilities()).resolves.toEqual({
      javascriptAvailable: true,
      shellSupported: false,
      shellAvailable: false,
      shellProvider: null,
      unavailableReason: 'The Android Termux bridge is not linked in this build.',
    });
  });

  it('reports Android bridge capabilities when Termux is available', async () => {
    const nativeModule = {
      getAvailability: jest.fn().mockResolvedValue({
        available: true,
        serviceAvailable: true,
        reason: null,
      }),
    };
    const { getLocalRuntimeCapabilities } = loadLocalRuntime({ os: 'android', nativeModule });

    await expect(getLocalRuntimeCapabilities()).resolves.toEqual({
      javascriptAvailable: true,
      shellSupported: true,
      shellAvailable: true,
      shellProvider: 'termux',
      unavailableReason: undefined,
    });
  });

  it('surfaces Android bridge detection errors', async () => {
    const nativeModule = {
      getAvailability: jest.fn().mockRejectedValue(new Error('availability failed')),
    };
    const { getLocalRuntimeCapabilities } = loadLocalRuntime({ os: 'android', nativeModule });

    await expect(getLocalRuntimeCapabilities()).resolves.toEqual({
      javascriptAvailable: true,
      shellSupported: false,
      shellAvailable: false,
      shellProvider: null,
      unavailableReason: 'availability failed',
    });
  });

  it('throws when local shell execution is requested outside Android', async () => {
    const { executeLocalShellCommand } = loadLocalRuntime({ os: 'ios' });

    await expect(executeLocalShellCommand('pwd')).rejects.toThrow(
      'Local shell execution is only supported on Android in this build.',
    );
  });

  it('throws when the Android bridge cannot execute shell commands', async () => {
    const { executeLocalShellCommand } = loadLocalRuntime({ os: 'android', nativeModule: {} });

    await expect(executeLocalShellCommand('pwd')).rejects.toThrow(
      'The Android Termux bridge is not linked in this build.',
    );
  });

  it('executes local shell commands through the Android bridge', async () => {
    const nativeModule = {
      execute: jest.fn().mockResolvedValue({
        stdout: 'build ok\n__KAVI_CWD__:/workspace',
        stderr: '',
        exitCode: 0,
        errCode: -1,
        durationMs: 25,
        stdoutOriginalLength: null,
        stderrOriginalLength: null,
      }),
    };
    const { executeLocalShellCommand } = loadLocalRuntime({ os: 'android', nativeModule });

    await expect(
      executeLocalShellCommand('npm test', {
        workingDirectory: '/workspace',
        stdin: 'yes',
        timeoutMs: 1234,
      }),
    ).resolves.toEqual({
      ok: true,
      stdout: 'build ok',
      stderr: '',
      exitCode: 0,
      errCode: -1,
      errorMessage: undefined,
      workingDirectory: '/workspace',
      durationMs: 25,
      stdoutWasTruncated: false,
      stderrWasTruncated: false,
    });

    expect(nativeModule.execute).toHaveBeenCalledWith(
      buildShellRuntimeCommand('npm test', '/workspace'),
      null,
      'yes',
      1234,
    );
  });
});
