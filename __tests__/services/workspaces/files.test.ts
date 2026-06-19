// ---------------------------------------------------------------------------
// Tests — Workspace File Operations Client
// ---------------------------------------------------------------------------

import {
  readWorkspaceFile,
  writeWorkspaceFile,
  listWorkspaceDirectory,
  makeWorkspaceDirectory,
  renameWorkspaceFile,
  deleteWorkspaceFile,
} from '../../../src/services/workspaces/files';
import type { WorkspaceTargetConfig } from '../../../src/types/remote';

const mockResolveWorkspaceTargetLaunch = jest.fn().mockResolvedValue({
  uri: 'https://code-server.example.com',
  headers: { Authorization: 'Bearer test-token' },
});

jest.mock('../../../src/services/workspaces/connector', () => {
  const actual = jest.requireActual('../../../src/services/workspaces/connector');
  return {
    ...actual,
    resolveWorkspaceTargetLaunch: (...args: any[]) => mockResolveWorkspaceTargetLaunch(...args),
  };
});

const codeServerTarget: WorkspaceTargetConfig = {
  id: 'ws-1',
  name: 'Dev Server',
  rootPath: '/workspace/project',
  provider: 'code-server',
  baseUrl: 'https://code-server.example.com',
  authMode: 'bearer',
  accessTokenRef: 'ws_token',
  enabled: true,
};

const customTarget: WorkspaceTargetConfig = {
  id: 'ws-2',
  name: 'Custom Server',
  rootPath: '/home/user/project',
  provider: 'custom',
  baseUrl: 'https://custom.example.com',
  authMode: 'bearer',
  accessTokenRef: 'custom_token',
  enabled: true,
};

function mockFetchText(responseText: string, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => responseText,
  }) as any;
}

function mockFetchJson(data: unknown, status = 200) {
  mockFetchText(JSON.stringify(data), status);
}

describe('workspace file ops – code-server provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveWorkspaceTargetLaunch.mockResolvedValue({
      uri: 'https://code-server.example.com',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('readWorkspaceFile sends GET to /api/v1/file with path', async () => {
    mockFetchText('file content here');

    const result = await readWorkspaceFile(codeServerTarget, 'src/index.ts');

    expect(result.path).toBe('/workspace/project/src/index.ts');
    expect(result.content).toBe('file content here');
    expect(result.size).toBe('file content here'.length);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/file?path=');
    expect(url).toContain(encodeURIComponent('/workspace/project/src/index.ts'));
    expect(init.method).toBe('GET');
  });

  it('readWorkspaceFile rejects absolute paths that escape the configured root', async () => {
    mockFetchText('absolute');

    await expect(readWorkspaceFile(codeServerTarget, '/absolute/path/file.ts')).rejects.toThrow(
      'Workspace path escapes configured root',
    );
  });

  it('writeWorkspaceFile sends POST to /api/v1/file with content', async () => {
    mockFetchText('');

    const result = await writeWorkspaceFile(codeServerTarget, 'out.txt', 'Hello World');

    expect(result.path).toBe('/workspace/project/out.txt');
    expect(result.size).toBe('Hello World'.length);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/file?path=');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('Hello World');
  });

  it('listWorkspaceDirectory sends GET to /api/v1/directory', async () => {
    mockFetchJson([
      { name: 'src', isFile: false, size: 0 },
      { name: 'package.json', isFile: true, size: 1024 },
    ]);

    const result = await listWorkspaceDirectory(codeServerTarget, '.');

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].name).toBe('src');
    expect(result.entries[0].isDirectory).toBe(true);
    expect(result.entries[1].name).toBe('package.json');
    expect(result.entries[1].isDirectory).toBe(false);
    expect(result.entries[1].size).toBe(1024);

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/directory?path=');
  });

  it('makeWorkspaceDirectory sends POST to /api/v1/directory', async () => {
    mockFetchText('');

    await makeWorkspaceDirectory(codeServerTarget, 'new-dir');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/directory?path=');
    expect(url).toContain(encodeURIComponent('/workspace/project/new-dir'));
    expect(init.method).toBe('POST');
  });

  it('renameWorkspaceFile sends PATCH to /api/v1/file', async () => {
    mockFetchText('');

    await renameWorkspaceFile(codeServerTarget, 'old.ts', 'new.ts');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/file?path=');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body);
    expect(body.newPath).toBe('/workspace/project/new.ts');
  });

  it('deleteWorkspaceFile sends DELETE to /api/v1/file', async () => {
    mockFetchText('');

    await deleteWorkspaceFile(codeServerTarget, 'temp.txt');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/file?path=');
    expect(url).toContain(encodeURIComponent('/workspace/project/temp.txt'));
    expect(init.method).toBe('DELETE');
  });

  it('includes auth headers from resolver', async () => {
    mockFetchText('');

    await readWorkspaceFile(codeServerTarget, 'test.ts');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('throws on HTTP error', async () => {
    mockFetchText('Not Found', 404);

    await expect(readWorkspaceFile(codeServerTarget, 'missing.ts')).rejects.toThrow(
      /Workspace API error \(404\)/,
    );
  });
});

describe('workspace file ops – custom provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveWorkspaceTargetLaunch.mockResolvedValue({
      uri: 'https://custom.example.com',
      headers: { Authorization: 'Bearer custom-token' },
    });
  });

  it('readWorkspaceFile sends GET to /files/{path}', async () => {
    mockFetchText('custom content');

    const result = await readWorkspaceFile(customTarget, 'src/app.ts');

    expect(result.content).toBe('custom content');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://custom.example.com/files/home/user/project/src/app.ts');
  });

  it('writeWorkspaceFile sends PUT to /files/{path}', async () => {
    mockFetchText('');

    await writeWorkspaceFile(customTarget, 'out.txt', 'Data');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/files/home/user/project/out.txt');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('Data');
  });

  it('listWorkspaceDirectory sends GET to /files/{path}?list=true', async () => {
    mockFetchJson([
      { name: 'file.txt', isDirectory: false },
      { name: 'subdir', isDirectory: true },
    ]);

    const result = await listWorkspaceDirectory(customTarget, 'src');

    expect(result.entries).toHaveLength(2);
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('?list=true');
  });

  it('makeWorkspaceDirectory sends PUT to /files/{path}?mkdir=true', async () => {
    mockFetchText('');

    await makeWorkspaceDirectory(customTarget, 'lib');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('?mkdir=true');
    expect(init.method).toBe('PUT');
  });

  it('renameWorkspaceFile sends POST to /files/{path}?rename=...', async () => {
    mockFetchText('');

    await renameWorkspaceFile(customTarget, 'old.ts', 'new.ts');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('?rename=');
    expect(init.method).toBe('POST');
  });

  it('deleteWorkspaceFile sends DELETE to /files/{path}', async () => {
    mockFetchText('');

    await deleteWorkspaceFile(customTarget, 'temp.txt');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/files/home/user/project/temp.txt');
    expect(init.method).toBe('DELETE');
  });
});

describe('workspace file ops – openvscode-server provider', () => {
  const ovsTarget: WorkspaceTargetConfig = {
    ...codeServerTarget,
    id: 'ws-ovs',
    provider: 'openvscode-server',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveWorkspaceTargetLaunch.mockResolvedValue({
      uri: 'https://code-server.example.com',
      headers: {},
    });
  });

  it('uses code-server API paths for openvscode-server', async () => {
    mockFetchText('ovs content');

    const result = await readWorkspaceFile(ovsTarget, 'test.ts');

    expect(result.content).toBe('ovs content');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v1/file?path=');
  });
});
