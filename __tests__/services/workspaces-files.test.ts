import {
  deleteWorkspaceFile,
  listWorkspaceDirectory,
  readWorkspaceFile,
  renameWorkspaceFile,
  writeWorkspaceFile,
} from '../../src/services/workspaces/files';

const mockResolveWorkspaceTargetLaunch = jest.fn();

jest.mock('../../src/services/workspaces/connector', () => ({
  getWorkspaceProviderFileAccessMode: (provider?: string) => {
    if (provider === 'code-server' || provider === 'openvscode-server') {
      return 'native';
    }
    if (provider === 'custom' || provider == null) {
      return 'custom';
    }
    return 'none';
  },
  resolveWorkspaceTargetLaunch: (...args: any[]) => mockResolveWorkspaceTargetLaunch(...args),
}));

const makeTarget = (overrides: Partial<any> = {}) => ({
  id: 'ws-1',
  name: 'Workspace',
  rootPath: '/workspace/project',
  baseUrl: 'https://workspace.example.com/api',
  provider: 'custom',
  enabled: true,
  ...overrides,
});

describe('workspace files service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveWorkspaceTargetLaunch.mockResolvedValue({
      uri: 'https://workspace.example.com/?folder=%2Fworkspace%2Fproject',
      headers: { Authorization: 'Bearer token-123' },
      provider: 'custom',
    });
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('ok'),
    });
  });

  it('encodes custom-provider file paths safely on write', async () => {
    await writeWorkspaceFile(makeTarget(), 'src/My File.ts', 'export const x = 1;');

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://workspace.example.com/api/files/workspace/project/src/My%20File.ts',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Content-Type': 'text/plain',
        }),
        body: 'export const x = 1;',
      }),
    );
  });

  it('allows absolute paths only when they stay under the configured root', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('console.log(1);'),
    });

    const result = await readWorkspaceFile(
      makeTarget({ provider: 'code-server', baseUrl: 'https://code.example.com' }),
      '/workspace/project/src/App.tsx',
    );

    expect(result.path).toBe('/workspace/project/src/App.tsx');
    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://code.example.com/api/v1/file?path=%2Fworkspace%2Fproject%2Fsrc%2FApp.tsx',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects traversal that would escape the configured root', async () => {
    await expect(readWorkspaceFile(makeTarget(), '../../etc/passwd')).rejects.toThrow(
      'escapes configured root',
    );
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('rejects absolute paths outside the configured root', async () => {
    await expect(deleteWorkspaceFile(makeTarget(), '/etc/passwd')).rejects.toThrow(
      'escapes configured root',
    );
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('validates content when writing directly through the service', async () => {
    await expect(writeWorkspaceFile(makeTarget(), 'README.md', undefined as any)).rejects.toThrow(
      'content must be a string',
    );
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('rejects file operations for providers without a file API', async () => {
    await expect(
      readWorkspaceFile(
        makeTarget({ provider: 'cursor', baseUrl: 'https://cursor.example.com' }),
        'README.md',
      ),
    ).rejects.toThrow('does not support file operations');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('encodes rename destinations for custom providers', async () => {
    await renameWorkspaceFile(makeTarget(), 'src/old name.ts', 'src/New File.ts');

    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://workspace.example.com/api/files/workspace/project/src/old%20name.ts?rename=%2Fworkspace%2Fproject%2Fsrc%2FNew+File.ts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lists the workspace root when path is omitted', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify([{ name: 'src', isDirectory: true }])),
    });

    const result = await listWorkspaceDirectory(makeTarget(), '.');

    expect(result.path).toBe('/workspace/project');
    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://workspace.example.com/api/files/workspace/project?list=true',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
