import { gzipSync, strToU8 } from 'fflate';

const brotliJs = require('brotli-js') as {
  compressArray(input: Uint8Array, level?: number): ArrayLike<number>;
};

export { strToU8 };

export const mockExpoEasHarnessState: { settingsState: any } = {
  settingsState: undefined,
};

export const mockGetSecure = jest.fn();
export const mockExecuteSshCommand = jest.fn();
export const mockStartRemoteJob = jest.fn();
export const mockUpdateRemoteJob = jest.fn();
export const mockAddRemoteArtifact = jest.fn();

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  executeSshCommand: (...args: any[]) => mockExecuteSshCommand(...args),
}));

jest.mock('../../src/services/remote/store', () => ({
  startRemoteJob: (...args: any[]) => mockStartRemoteJob(...args),
  updateRemoteJob: (...args: any[]) => mockUpdateRemoteJob(...args),
  addRemoteArtifact: (...args: any[]) => mockAddRemoteArtifact(...args),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockExpoEasHarnessState.settingsState,
    setState: (updater: any) => {
      mockExpoEasHarnessState.settingsState =
        typeof updater === 'function'
          ? {
              ...mockExpoEasHarnessState.settingsState,
              ...updater(mockExpoEasHarnessState.settingsState),
            }
          : { ...mockExpoEasHarnessState.settingsState, ...updater };
    },
  },
}));

export const directProject = {
  id: 'expo-project-1',
  name: 'Kavi',
  accountId: 'expo-account-1',
  owner: 'kavi',
  slug: 'kavi-app',
  enabled: true,
  mode: 'direct-ssh' as const,
  sshTargetId: 'ssh-1',
  projectPath: '/srv/kavi-app',
  platforms: ['android', 'ios', 'web'] as Array<'android' | 'ios' | 'web'>,
};

export const account = {
  id: 'expo-account-1',
  name: 'Expo Prod',
  owner: 'kavi',
  tokenRef: 'expo_account_token_expo-account-1',
  enabled: true,
};

export function createSettingsState() {
  return {
    expoAccounts: [
      {
        ...account,
      },
    ],
    expoProjects: [
      {
        ...directProject,
        easProjectId: 'eas-project-1',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
      },
      {
        id: 'expo-project-2',
        easProjectId: 'eas-project-2',
        name: 'Kavi Workflow',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'kavi-app',
        enabled: true,
        mode: 'github-workflow',
        repoFullName: 'kavi/mobile',
        workflowFile: '.github/workflows/eas.yml',
        workflowRef: 'main',
        githubTokenRef: 'GITHUB_TOKEN',
        platforms: ['android', 'ios', 'web'],
      },
    ],
    sshTargets: [
      {
        id: 'ssh-1',
        name: 'Build box',
        host: 'ssh.example.com',
        port: 22,
        username: 'builder',
        enabled: true,
      },
    ],
  };
}

export function resetExpoEasMocks() {
  mockGetSecure.mockReset();
  mockExecuteSshCommand.mockReset();
  mockStartRemoteJob.mockReset();
  mockUpdateRemoteJob.mockReset();
  mockAddRemoteArtifact.mockReset();

  mockExpoEasHarnessState.settingsState = createSettingsState();
  mockGetSecure.mockImplementation(async (key: string) => {
    if (key === 'expo_account_token_expo-account-1') return 'expo-token';
    if (key === 'GITHUB_TOKEN') return 'github-token';
    return null;
  });
  mockExecuteSshCommand.mockResolvedValue('builder');
  mockStartRemoteJob.mockReturnValue('remote-job-1');
  global.fetch = jest.fn() as any;
}

export function createHeaderBag(entries?: Record<string, string>) {
  return {
    get(name: string) {
      if (!entries) {
        return null;
      }

      const direct = entries[name];
      if (typeof direct === 'string') {
        return direct;
      }

      const matchedKey = Object.keys(entries).find(
        (key) => key.toLowerCase() === name.toLowerCase(),
      );
      return matchedKey ? entries[matchedKey] : null;
    },
  };
}

export function latin1Bytes(body: string): Uint8Array {
  return Uint8Array.from(Array.from(body, (char) => char.charCodeAt(0) & 0xff));
}

export function mockByteResponse(bytes: Uint8Array, headers?: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    headers: createHeaderBag(headers),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as any;
}

export function mockTextResponse(body: string) {
  const bytes = strToU8(body);
  return mockByteResponse(bytes, { 'content-type': 'application/x-ndjson; charset=utf-8' });
}

export function mockGzipResponse(body: string) {
  const compressed = gzipSync(strToU8(body));
  return mockByteResponse(compressed, {
    'content-encoding': 'gzip',
    'content-type': 'application/x-ndjson; charset=utf-8',
  });
}

export function mockBrotliResponse(body: string) {
  const compressed = Uint8Array.from(brotliJs.compressArray(strToU8(body), 6));
  return mockByteResponse(compressed, {
    'content-encoding': 'br',
    'content-type': 'application/x-ndjson; charset=utf-8',
  });
}

export function mockExpoGraphql(
  handler: (body: { query: string; variables?: Record<string, any> }) => any,
) {
  (global.fetch as jest.Mock).mockImplementation(async (_url: string, init?: RequestInit) => {
    const payload = handler(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      status: 200,
      headers: createHeaderBag({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    } as any;
  });
}
