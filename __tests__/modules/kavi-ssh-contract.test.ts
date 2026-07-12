import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.mock('expo', () => {
  const nativeModule = {
    discoverHostKey: jest.fn(),
    connectVerified: jest.fn(),
    exec: jest.fn(),
    disconnect: jest.fn(),
  };
  const requestedModuleNames: string[] = [];
  return {
    NativeModule: class {},
    requireNativeModule: (name: string) => {
      requestedModuleNames.push(name);
      return nativeModule;
    },
    __kaviSshNativeModule: nativeModule,
    __kaviSshRequestedModuleNames: requestedModuleNames,
  };
});

import {
  KaviSshContractError,
  parseConnectVerifiedRequest,
  parseDisconnectResult,
  parseExecResult,
  parseSshHostKey,
} from '../../modules/kavi-ssh/src/contract';
import { connectVerified, disconnect, exec } from '../../modules/kavi-ssh/src';

const expoMock = jest.requireMock('expo') as {
  __kaviSshNativeModule: {
    discoverHostKey: jest.Mock;
    connectVerified: jest.Mock;
    exec: jest.Mock;
    disconnect: jest.Mock;
  };
  __kaviSshRequestedModuleNames: string[];
};
const mockSshNativeModule = expoMock.__kaviSshNativeModule;

const hostKey = {
  algorithm: 'ssh-ed25519',
  publicKeyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  fingerprintSha256: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
};

describe('kavi-ssh final-form contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts canonical OpenSSH SHA-256 host-key identity', () => {
    expect(parseSshHostKey(hostKey)).toEqual(hostKey);
  });

  it('keeps Expo registration and JavaScript native-module names aligned', () => {
    const moduleRoot = path.resolve(__dirname, '../../modules/kavi-ssh');
    const config = JSON.parse(
      readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8'),
    ) as {
      apple: { modules: string[] };
      android: { modules: string[] };
    };
    const swiftModule = readFileSync(path.join(moduleRoot, 'ios/KaviSshModule.swift'), 'utf8');
    const kotlinModule = readFileSync(
      path.join(moduleRoot, 'android/src/main/java/com/kavi/modules/ssh/KaviSshModule.kt'),
      'utf8',
    );

    expect(config.apple.modules).toEqual(['KaviSshModule']);
    expect(config.android.modules).toEqual(['com.kavi.modules.ssh.KaviSshModule']);
    expect(swiftModule).toContain('public final class KaviSshModule: Module');
    expect(kotlinModule).toContain('class KaviSshModule : Module()');
    expect(swiftModule).toContain('Name("KaviSsh")');
    expect(kotlinModule).toContain('Name("KaviSsh")');
    expect(expoMock.__kaviSshRequestedModuleNames).toEqual(['KaviSsh']);
  });

  it('rejects legacy MD5 and colon-delimited fingerprints', () => {
    expect(() =>
      parseSshHostKey({
        ...hostKey,
        fingerprintSha256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      }),
    ).toThrow(
      expect.objectContaining<KaviSshContractError>({
        code: 'ERR_SSH_INVALID_ARGUMENT',
        field: 'hostKey.fingerprintSha256',
      }),
    );
  });

  it('requires one unambiguous authentication method and an exact expected host key', () => {
    expect(
      parseConnectVerifiedRequest({
        endpoint: { host: 'ssh.example.com', port: 22 },
        username: 'developer',
        authentication: { kind: 'private-key', privateKey: 'fixture-private-key' },
        expectedHostKey: hostKey,
        timeoutMs: 15_000,
      }),
    ).toEqual({
      endpoint: { host: 'ssh.example.com', port: 22 },
      username: 'developer',
      authentication: { kind: 'private-key', privateKey: 'fixture-private-key' },
      expectedHostKey: hostKey,
      timeoutMs: 15_000,
    });

    expect(() =>
      parseConnectVerifiedRequest({
        endpoint: { host: 'ssh.example.com', port: 22 },
        username: 'developer',
        authentication: {
          kind: 'password',
          password: 'secret',
          privateKey: 'ambiguous-key',
        },
        expectedHostKey: hostKey,
        timeoutMs: 15_000,
      }),
    ).toThrow(expect.objectContaining<KaviSshContractError>({ code: 'ERR_SSH_INVALID_ARGUMENT' }));
  });

  it('preserves separate exec streams and exactly one termination status', () => {
    const result = {
      connectionId: 'fixture-connection-0001',
      stdout: 'output\n',
      stderr: 'warning\n',
      exitCode: 23,
      signal: null,
      durationMs: 8,
    };
    expect(parseExecResult(result)).toEqual(result);
    expect(() => parseExecResult({ ...result, signal: 'SIGTERM' })).toThrow(
      expect.objectContaining<KaviSshContractError>({
        code: 'ERR_SSH_INVALID_NATIVE_RESPONSE',
        field: 'result.termination',
      }),
    );
  });

  it('accepts only the deterministic disconnected state', () => {
    expect(
      parseDisconnectResult({
        connectionId: 'fixture-connection-0001',
        state: 'disconnected',
      }),
    ).toEqual({ connectionId: 'fixture-connection-0001', state: 'disconnected' });
    expect(() =>
      parseDisconnectResult({
        connectionId: 'fixture-connection-0001',
        state: 'disconnecting',
      }),
    ).toThrow(
      expect.objectContaining<KaviSshContractError>({
        code: 'ERR_SSH_INVALID_NATIVE_RESPONSE',
        field: 'result.state',
      }),
    );
  });

  it('rejects a native connect response that does not echo the exact pinned host key', async () => {
    mockSshNativeModule.connectVerified.mockResolvedValue({
      connectionId: 'fixture-connection-0001',
      verifiedHostKey: {
        ...hostKey,
        fingerprintSha256: 'SHA256:ADiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
      },
    });

    await expect(
      connectVerified({
        endpoint: { host: 'ssh.example.com', port: 22 },
        username: 'developer',
        authentication: { kind: 'password', password: 'secret' },
        expectedHostKey: hostKey,
        timeoutMs: 15_000,
      }),
    ).rejects.toEqual(
      expect.objectContaining<KaviSshContractError>({
        code: 'ERR_SSH_INVALID_NATIVE_RESPONSE',
        field: 'result.verifiedHostKey',
      }),
    );
  });

  it('rejects native exec output beyond the caller bound and preserves deterministic disconnect', async () => {
    mockSshNativeModule.exec.mockResolvedValue({
      connectionId: 'fixture-connection-0001',
      stdout: 'four',
      stderr: '',
      exitCode: 0,
      signal: null,
      durationMs: 1,
    });
    await expect(
      exec({
        connectionId: 'fixture-connection-0001',
        command: 'printf four',
        timeoutMs: 15_000,
        outputLimitBytes: 3,
      }),
    ).rejects.toEqual(
      expect.objectContaining<KaviSshContractError>({
        code: 'ERR_SSH_INVALID_NATIVE_RESPONSE',
        field: 'result.outputLimitBytes',
      }),
    );

    mockSshNativeModule.disconnect.mockResolvedValue({
      connectionId: 'fixture-connection-0001',
      state: 'disconnected',
    });
    await expect(
      disconnect({ connectionId: 'fixture-connection-0001', timeoutMs: 15_000 }),
    ).resolves.toEqual({ connectionId: 'fixture-connection-0001', state: 'disconnected' });
  });
});
