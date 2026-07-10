import {
  installNativeToolExecutionEnvironment,
  tryExecuteNativeToolInEnvironment,
} from '../../src/engine/tools/native/executionEnvironment';

describe('native tool execution environment', () => {
  let uninstallEnvironment: (() => void) | null = null;

  afterEach(() => {
    uninstallEnvironment?.();
    uninstallEnvironment = null;
  });

  it('forwards a native request only while the environment is installed', async () => {
    const tryExecute = jest.fn(async () => '{"status":"fixture"}');
    const request = {
      name: 'calendar_list',
      argsString: '{}',
      conversationId: 'conv-native-environment',
    };

    expect(await tryExecuteNativeToolInEnvironment(request)).toBeNull();

    uninstallEnvironment = installNativeToolExecutionEnvironment({ tryExecute });
    expect(await tryExecuteNativeToolInEnvironment(request)).toBe('{"status":"fixture"}');
    expect(tryExecute).toHaveBeenCalledWith(request);

    uninstallEnvironment();
    uninstallEnvironment = null;
    expect(await tryExecuteNativeToolInEnvironment(request)).toBeNull();
  });

  it('rejects overlapping process-scoped environments', () => {
    uninstallEnvironment = installNativeToolExecutionEnvironment({
      tryExecute: async () => null,
    });

    expect(() =>
      installNativeToolExecutionEnvironment({
        tryExecute: async () => null,
      }),
    ).toThrow('A native tool execution environment is already installed.');
  });
});
