jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import { getSecure } from '../../src/services/storage/SecureStorage';
import { createGitHubSkill } from '../../src/services/integrations/github/skill';

const mockGetSecure = getSecure as jest.Mock;

function getGitHubTool(name: string) {
  const tool = createGitHubSkill().tools.find((entry) => entry.name === name);
  if (!tool?.handler) {
    throw new Error(`Missing GitHub tool: ${name}`);
  }
  return tool;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
});

describe('GitHub skill edge cases', () => {
  it('list_files lists repository contents with a normalized full ref', async () => {
    mockGetSecure.mockResolvedValue('ghp_test');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          name: 'README.md',
          path: 'README.md',
          type: 'file',
          sha: 'readme-sha',
          size: 42,
          html_url: 'https://github.com/user/repo/blob/main/README.md',
        },
      ],
    });

    const result = await getGitHubTool('list_files').handler!({
      repo: 'https://github.com/user/repo',
      path: '',
      ref: 'refs/heads/main',
    });
    const parsed = JSON.parse(result);

    expect(parsed).toEqual([
      expect.objectContaining({
        name: 'README.md',
        path: 'README.md',
        type: 'file',
      }),
    ]);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/user/repo/contents?ref=main',
    );
  });

  it('commit_files can delete a file without creating a replacement blob', async () => {
    mockGetSecure.mockResolvedValue('ghp_test');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: 'head-sha' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ default_branch: 'main' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ tree: { sha: 'tree-sha' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ sha: 'next-tree-sha' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          sha: 'commit-sha',
          html_url: 'https://github.com/user/repo/commit/commit-sha',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ref: 'refs/heads/feature/delete-doc' }),
      });

    const result = await getGitHubTool('commit_files').handler!({
      repo: 'user/repo',
      branch: 'feature/delete-doc',
      message: 'Remove obsolete docs',
      changes: [{ path: 'docs/old.md', delete: true }],
    });
    const parsed = JSON.parse(result);
    const treeRequest = JSON.parse(mockFetch.mock.calls[3][1].body);

    expect(parsed.changedFiles).toEqual(['docs/old.md']);
    expect(treeRequest.tree).toEqual([
      { path: 'docs/old.md', mode: '100644', type: 'blob', sha: null },
    ]);
    expect(mockFetch.mock.calls.map((call) => call[0])).not.toContain(
      'https://api.github.com/repos/user/repo/git/blobs',
    );
  });

  it('commit_files rejects blank commit messages before calling GitHub', async () => {
    await expect(
      getGitHubTool('commit_files').handler!({
        repo: 'user/repo',
        branch: 'feature/test',
        message: '   ',
        changes: [{ path: 'README.md', content: 'Updated' }],
      }),
    ).rejects.toThrow('GitHub commit message is required');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('create_issue drops non-array labels instead of serializing invalid labels', async () => {
    mockGetSecure.mockResolvedValue('ghp_test');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        number: 42,
        html_url: 'https://github.com/user/repo/issues/42',
        state: 'open',
      }),
    });

    await getGitHubTool('create_issue').handler!({
      repo: 'user/repo',
      title: 'New issue',
      labels: 'bug',
    });

    expect(JSON.parse(mockFetch.mock.calls[0][1].body).labels).toEqual([]);
  });

  it('create_pull_request rethrows duplicate errors when no matching pull request exists', async () => {
    mockGetSecure.mockResolvedValue('ghp_test');
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () =>
          JSON.stringify({ message: 'A pull request already exists for user:feature/test.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

    await expect(
      getGitHubTool('create_pull_request').handler!({
        repo: 'user/repo',
        title: 'Existing PR',
        head: 'feature/test',
        base: 'main',
      }),
    ).rejects.toThrow('A pull request already exists');
  });

  it('workflow_runs resolves the repository default branch when no target is provided', async () => {
    mockGetSecure.mockResolvedValue('ghp_test');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ default_branch: 'main' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sha: 'main-sha' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ default_branch: 'main' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sha: 'main-sha' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      });

    const result = await getGitHubTool('workflow_runs').handler!({ repo: 'user/repo' });
    const parsed = JSON.parse(result);

    expect(parsed.ref).toBe('main');
    expect(parsed.branch).toBe('main');
    expect(mockFetch.mock.calls[4][0]).toContain('branch=main');
  });

  it('checks_status resolves pull request heads and reports base branch metadata', async () => {
    mockGetSecure.mockResolvedValue('ghp_test');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          head: { ref: 'feature/test', sha: 'head-sha' },
          base: { ref: 'main' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'success', sha: 'head-sha', statuses: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          head: { ref: 'feature/test', sha: 'head-sha' },
          base: { ref: 'main' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      });

    const result = await getGitHubTool('checks_status').handler!({
      repo: 'user/repo',
      pullNumber: 5,
    });
    const parsed = JSON.parse(result);

    expect(parsed.pullNumber).toBe(5);
    expect(parsed.baseBranch).toBe('main');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/user/repo/pulls/5');
    expect(mockFetch.mock.calls[4][0]).toContain('branch=feature%2Ftest');
  });
});
