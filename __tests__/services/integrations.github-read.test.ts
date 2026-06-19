import {
  installServiceIntegrationsReset,
  createGitHubSkill,
  mockFetch,
  mockGetSecure,
} from '../helpers/serviceIntegrationsHarness';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('createGitHubSkill', () => {
    it('should create github skill with repo automation tools', () => {
      const skill = createGitHubSkill();
      expect(skill.id).toBe('github');
      expect(skill.tools.map((t) => t.name)).toEqual([
        'repos',
        'branches',
        'list_files',
        'read_file',
        'create_branch',
        'commit_files',
        'issues',
        'create_issue',
        'create_pull_request',
        'workflow_runs',
        'checks_status',
      ]);
    });

    it('marks critical GitHub tools as strict with closed schemas', () => {
      const skill = createGitHubSkill();
      const strictTools = [
        'list_files',
        'read_file',
        'create_branch',
        'commit_files',
        'create_issue',
        'create_pull_request',
      ];

      for (const toolName of strictTools) {
        const tool = skill.tools.find((entry) => entry.name === toolName);
        expect(tool?.strict).toBe(true);
        expect(tool?.input_schema.additionalProperties).toBe(false);
      }

      const commitTool = skill.tools.find((tool) => tool.name === 'commit_files');
      expect((commitTool?.input_schema.properties.changes as any).items.additionalProperties).toBe(
        false,
      );
      expect(
        (commitTool?.input_schema.properties.changes as any).items.properties.filePath.type,
      ).toBe('string');
    });

    it('repos tool should list repos', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      const repoData = [
        {
          full_name: 'user/repo',
          description: 'A repo',
          stargazers_count: 5,
          language: 'TypeScript',
          updated_at: '2025-01-01',
          html_url: 'https://github.com/user/repo',
        },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => repoData,
      });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'repos')!.handler!({});
      const data = JSON.parse(result);
      expect(data[0].name).toBe('user/repo');
    });

    it('issues tool should list issues', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      const issueData = [
        {
          number: 1,
          title: 'Bug',
          state: 'open',
          user: { login: 'user' },
          labels: [{ name: 'bug' }],
          created_at: '2025-01-01',
          html_url: 'https://github.com/user/repo/issues/1',
        },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => issueData,
      });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'issues')!.handler!({
        repo: 'user/repo',
      });
      const data = JSON.parse(result);
      expect(data[0].number).toBe(1);
    });

    it('read_file should use the GitHub contents API for private repo files', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'file',
          path: 'README.md',
          sha: 'sha-readme',
          size: 5,
          encoding: 'base64',
          content: 'SGVsbG8=',
          html_url: 'https://github.com/user/repo/blob/main/README.md',
        }),
      });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'read_file')!.handler!({
        repo: 'user/repo',
        path: 'README.md',
        ref: 'main',
      });
      const data = JSON.parse(result);

      expect(data.content).toBe('Hello');
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.github.com/repos/user/repo/contents/README.md?ref=main',
      );
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer ghp_test');
    });

    it('read_file should normalize GitHub URLs and full refs before calling the contents API', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          type: 'file',
          path: 'docs/guide.md',
          sha: 'sha-guide',
          size: 9,
          encoding: 'base64',
          content: 'R3VpZGUgdGV4dA==',
          html_url: 'https://github.com/user/repo/blob/main/docs/guide.md',
        }),
      });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'read_file')!.handler!({
        repo: 'git@github.com:user/repo.git',
        path: 'https://github.com/user/repo/blob/main/docs/guide.md?plain=1',
        ref: 'refs/heads/main',
      });
      const data = JSON.parse(result);

      expect(data.path).toBe('docs/guide.md');
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.github.com/repos/user/repo/contents/docs/guide.md?ref=main',
      );
    });

    it('read_file should explain when a path is missing in an otherwise accessible repo', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => JSON.stringify({ message: 'Not Found' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main' }),
        });

      const skill = createGitHubSkill();

      let thrown: Error | null = null;
      try {
        await skill.tools.find((tool) => tool.name === 'read_file')!.handler!({
          repo: 'user/repo',
          path: 'missing.txt',
          ref: 'refs/heads/main',
        });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).toContain('GitHub read_file returned 404');
      expect(thrown?.message).toContain(
        'The repository is reachable, so the path or ref is the most likely missing resource.',
      );
      expect(thrown?.message).toContain('Required permission: Contents: read.');
    });

    it('branches should explain when the token cannot access the target repository', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => JSON.stringify({ message: 'Not Found' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => JSON.stringify({ message: 'Not Found' }),
        });

      const skill = createGitHubSkill();

      let thrown: Error | null = null;
      try {
        await skill.tools.find((tool) => tool.name === 'branches')!.handler!({
          repo: 'user/private-repo',
        });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).toContain('GitHub branches returned 404');
      expect(thrown?.message).toContain(
        'The repository may not exist, or the token may not be granted to this private repository.',
      );
      expect(thrown?.message).toContain('Required permission: Contents: read.');
    });
  });
});
