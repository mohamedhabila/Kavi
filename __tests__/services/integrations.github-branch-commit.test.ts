import {
  installServiceIntegrationsReset,
  createGitHubSkill,
  Directory,
  File,
  Paths,
  mockFetch,
  mockGetSecure,
} from '../helpers/serviceIntegrationsHarness';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('createGitHubSkill', () => {
    it('create_branch should create a branch from the default branch when missing', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'missing branch',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'base-sha' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ ref: 'refs/heads/feature/test' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'base-sha' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'base-sha' } }),
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'create_branch')!.handler!({
        repo: 'user/repo',
        branch: 'feature/test',
      });
      const data = JSON.parse(result);

      expect(data.created).toBe(true);
      expect(data.baseBranch).toBe('main');
      expect(data.sha).toBe('base-sha');
      expect(mockFetch.mock.calls[3][0]).toBe('https://api.github.com/repos/user/repo/git/refs');
    });

    it('create_branch should tolerate delayed branch visibility after creation', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'missing branch',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'base-sha' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ ref: 'refs/heads/feature/test' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'still indexing',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'final-sha' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'final-sha' } }),
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'create_branch')!.handler!({
        repo: 'user/repo',
        branch: 'feature/test',
      });
      const data = JSON.parse(result);

      expect(data.created).toBe(true);
      expect(data.sha).toBe('final-sha');
    });

    it('create_branch should reconcile already-exists errors when the branch was created remotely', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'missing branch',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'base-sha' } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          text: async () => JSON.stringify({ message: 'Reference already exists' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'remote-sha' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'remote-sha' } }),
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'create_branch')!.handler!({
        repo: 'user/repo',
        branch: 'feature/test',
      });
      const data = JSON.parse(result);

      expect(data.created).toBe(false);
      expect(data.sha).toBe('remote-sha');
    });

    it('commit_files should create blobs, a tree, a commit, and update the branch ref', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        // 1. ensureGitHubBranch: getGitHubBranchHeadSha (branch exists check)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: 'head-sha' } }),
        })
        // 2. git/commits/{headSha} — get base tree
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ tree: { sha: 'tree-sha' } }),
        })
        // 3. git/blobs — create blob
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ sha: 'blob-sha' }),
        })
        // 4. git/trees — create tree
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ sha: 'next-tree-sha' }),
        })
        // 5. git/commits — create commit
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            sha: 'commit-sha',
            html_url: 'https://github.com/user/repo/commit/commit-sha',
          }),
        })
        // 6. git/refs — update ref
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ref: 'refs/heads/feature/test' }),
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'commit_files')!.handler!({
        repo: 'user/repo',
        branch: 'feature/test',
        baseBranch: 'main',
        message: 'Update docs',
        changes: [{ path: 'README.md', content: 'Updated docs' }],
      });
      const data = JSON.parse(result);

      expect(data.commitSha).toBe('commit-sha');
      expect(data.changedFiles).toEqual(['README.md']);
      expect(mockFetch.mock.calls[2][0]).toBe('https://api.github.com/repos/user/repo/git/blobs');
      expect(JSON.parse(mockFetch.mock.calls[3][1].body).tree[0].path).toBe('README.md');
      expect(mockFetch.mock.calls[5][0]).toBe(
        'https://api.github.com/repos/user/repo/git/refs/heads/feature/test',
      );
    });

    it('commit_files should read create or update content from a conversation workspace filePath', async () => {
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
          json: async () => ({ tree: { sha: 'tree-sha' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ sha: 'blob-sha' }),
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
          json: async () => ({ ref: 'refs/heads/feature/test' }),
        });

      const workspaceDir = new Directory(Paths.document, 'workspace', 'conv-1');
      new File(workspaceDir, 'drafts/README.md').write('Workspace docs');

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'commit_files')!.handler!(
        {
          repo: 'user/repo',
          branch: 'feature/test',
          baseBranch: 'main',
          message: 'Commit workspace file',
          changes: [{ path: 'README.md', filePath: '/drafts/README.md' }],
        },
        {
          conversationId: 'conv-1',
          readConversationFile: async (path: string) => {
            return await new File(workspaceDir, path).text();
          },
        },
      );
      const data = JSON.parse(result);

      expect(data.commitSha).toBe('commit-sha');
      expect(JSON.parse(mockFetch.mock.calls[2][1].body).content).toBe('Workspace docs');
      expect(JSON.parse(mockFetch.mock.calls[3][1].body).tree[0].path).toBe('README.md');
    });

    it('commit_files should reject changes that specify both content and filePath', async () => {
      const skill = createGitHubSkill();

      await expect(
        skill.tools.find((tool) => tool.name === 'commit_files')!.handler!({
          repo: 'user/repo',
          branch: 'feature/test',
          message: 'Bad commit',
          changes: [{ path: 'README.md', content: 'inline', filePath: 'drafts/README.md' }],
        }),
      ).rejects.toThrow('must include exactly one of content or filePath');
    });

    it('commit_files should reject filePath usage when no conversation workspace context is available', async () => {
      const skill = createGitHubSkill();

      await expect(
        skill.tools.find((tool) => tool.name === 'commit_files')!.handler!({
          repo: 'user/repo',
          branch: 'feature/test',
          message: 'Bad commit',
          changes: [{ path: 'README.md', filePath: 'drafts/README.md' }],
        }),
      ).rejects.toThrow('no conversation workspace is available');
    });

    it('commit_files should surface workflow permission errors with phase context', async () => {
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
          json: async () => ({ sha: 'blob-sha' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: async () => JSON.stringify({ message: 'Resource not accessible by integration' }),
        });

      const skill = createGitHubSkill();

      let thrown: Error | null = null;
      try {
        await skill.tools.find((tool) => tool.name === 'commit_files')!.handler!({
          repo: 'user/repo',
          branch: 'feature/test',
          message: 'Update workflow',
          changes: [{ path: '.github/workflows/ci.yml', content: 'name: CI' }],
        });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).toContain(
        'GitHub commit_files while creating the next tree was forbidden',
      );
      expect(thrown?.message).toContain(
        "Committing to .github/workflows/ requires the 'Workflows' permission",
      );
      expect(thrown?.message).toContain(
        'Required permission: Contents: write and Workflows: write when modifying .github/workflows/.',
      );
    });
  });
});
