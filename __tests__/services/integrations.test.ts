// ---------------------------------------------------------------------------
// Service Integrations — tests
// ---------------------------------------------------------------------------

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(),
}));

jest.mock('../../src/services/skills/manager', () => ({
  registerSkill: jest.fn(),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import { getSecure } from '../../src/services/storage/SecureStorage';
import { registerSkill } from '../../src/services/skills/manager';
import {
  createWeatherSkill,
  createGitHubSkill,
  createFinanceSkill,
  createKnowledgeSkill,
  registerBuiltInServiceSkills,
} from '../../src/services/integrations/services';

const { File, Directory, Paths, __resetStore } = require('expo-file-system');

const mockGetSecure = getSecure as jest.Mock;

describe('Service Integrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    __resetStore();
  });

  describe('createWeatherSkill', () => {
    it('should create weather skill with 2 tools', () => {
      const skill = createWeatherSkill();
      expect(skill.id).toBe('weather');
      expect(skill.name).toBe('Weather');
      expect(skill.tools).toHaveLength(2);
      expect(skill.tools[0].name).toBe('current');
      expect(skill.tools[1].name).toBe('forecast');
    });

    it('current tool should throw if no API key', async () => {
      mockGetSecure.mockResolvedValue(null);
      const skill = createWeatherSkill();
      await expect(skill.tools[0].handler!({ location: 'London' })).rejects.toThrow(
        'not configured',
      );
    });

    it('current tool should return weather data', async () => {
      mockGetSecure.mockResolvedValue('weather-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'London',
          main: { temp: 15, feels_like: 14, humidity: 70 },
          weather: [{ description: 'cloudy' }],
          wind: { speed: 5 },
        }),
      });

      const skill = createWeatherSkill();
      const result = await skill.tools[0].handler!({ location: 'London' });
      const data = JSON.parse(result);
      expect(data.location).toBe('London');
      expect(data.temp).toBe(15);
    });

    it('forecast tool should throw if no API key', async () => {
      mockGetSecure.mockResolvedValue(null);
      const skill = createWeatherSkill();
      await expect(skill.tools[1].handler!({ location: 'London' })).rejects.toThrow(
        'not configured',
      );
    });

    it('forecast tool should return forecast data', async () => {
      mockGetSecure.mockResolvedValue('weather-key');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          city: { name: 'London' },
          list: Array.from({ length: 40 }, (_, i) => ({
            dt_txt: `2025-01-0${Math.floor(i / 8) + 1}`,
            main: { temp: 10 + i },
            weather: [{ description: 'sunny' }],
          })),
        }),
      });

      const skill = createWeatherSkill();
      const result = await skill.tools[1].handler!({ location: 'London' });
      const data = JSON.parse(result);
      expect(data.location).toBe('London');
      expect(data.forecasts.length).toBe(5);
    });
  });

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
        base: 'main',
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
          base: 'main',
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

    it('create_issue tool should create issue', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          number: 42,
          html_url: 'https://github.com/user/repo/issues/42',
          state: 'open',
        }),
      });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'create_issue')!.handler!({
        repo: 'user/repo',
        title: 'New Bug',
        body: 'Details',
        labels: 'bug,urgent',
      });
      const data = JSON.parse(result);
      expect(data.number).toBe(42);
    });

    it('issues should exclude pull requests from the issues list', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            number: 1,
            title: 'Bug',
            state: 'open',
            user: { login: 'user' },
            labels: [{ name: 'bug' }],
            created_at: '2025-01-01',
            html_url: 'https://github.com/user/repo/issues/1',
          },
          {
            number: 2,
            title: 'Feature PR',
            state: 'open',
            user: { login: 'user' },
            labels: [],
            created_at: '2025-01-02',
            html_url: 'https://github.com/user/repo/pull/2',
            pull_request: { url: 'https://api.github.com/repos/user/repo/pulls/2' },
          },
        ],
      });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'issues')!.handler!({
        repo: 'user/repo',
      });
      const data = JSON.parse(result);

      expect(data).toHaveLength(1);
      expect(data[0].number).toBe(1);
    });

    it('create_pull_request should open a PR against the repo default branch', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ default_branch: 'main' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            number: 9,
            title: 'Ship feature',
            state: 'open',
            html_url: 'https://github.com/user/repo/pull/9',
            head: { ref: 'feature/test' },
            base: { ref: 'main' },
          }),
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'create_pull_request')!
        .handler!({
        repo: 'user/repo',
        title: 'Ship feature',
        head: 'feature/test',
        body: 'Ready for review',
      });
      const data = JSON.parse(result);

      expect(data.number).toBe(9);
      expect(data.base).toBe('main');
      expect(mockFetch.mock.calls[1][0]).toBe('https://api.github.com/repos/user/repo/pulls');
    });

    it('create_pull_request should return the existing PR instead of failing on duplicate requests', async () => {
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
          json: async () => [
            {
              number: 11,
              title: 'Existing PR',
              state: 'open',
              html_url: 'https://github.com/user/repo/pull/11',
              head: { ref: 'feature/test' },
              base: { ref: 'main' },
            },
          ],
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'create_pull_request')!
        .handler!({
        repo: 'user/repo',
        title: 'Existing PR',
        head: 'feature/test',
        base: 'main',
      });
      const data = JSON.parse(result);

      expect(data.number).toBe(11);
      expect(data.created).toBe(false);
      expect(mockFetch.mock.calls[1][0]).toContain('head=user%3Afeature%2Ftest');
    });

    it('workflow_runs should list runs for slash-named branches', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sha: 'head-sha' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sha: 'head-sha' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            workflow_runs: [
              {
                id: 101,
                name: 'CI',
                display_title: 'CI',
                event: 'push',
                status: 'completed',
                conclusion: 'failure',
                workflow_id: 88,
                head_branch: 'feature/test',
                head_sha: 'head-sha',
                html_url: 'https://github.com/user/repo/actions/runs/101',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:05:00Z',
              },
            ],
          }),
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'workflow_runs')!.handler!({
        repo: 'user/repo',
        branch: 'feature/test',
      });
      const data = JSON.parse(result);

      expect(data.runs).toHaveLength(1);
      expect(data.runs[0].conclusion).toBe('failure');
      expect(mockFetch.mock.calls[2][0]).toContain('branch=feature%2Ftest');
    });

    it('checks_status should summarize failing checks and workflow runs', async () => {
      mockGetSecure.mockResolvedValue('ghp_test');
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sha: 'head-sha' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            state: 'failure',
            sha: 'head-sha',
            statuses: [{ context: 'lint', state: 'failure', description: 'Lint failed' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            check_runs: [
              {
                id: 7,
                name: 'tests',
                status: 'completed',
                conclusion: 'failure',
                details_url: 'https://example.com/tests',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sha: 'head-sha' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            workflow_runs: [
              {
                id: 55,
                name: 'CI',
                display_title: 'CI',
                event: 'push',
                status: 'completed',
                conclusion: 'failure',
                workflow_id: 88,
                head_branch: 'feature/test',
                head_sha: 'head-sha',
                html_url: 'https://github.com/user/repo/actions/runs/55',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:05:00Z',
              },
            ],
          }),
        });

      const skill = createGitHubSkill();
      const result = await skill.tools.find((tool) => tool.name === 'checks_status')!.handler!({
        repo: 'user/repo',
        branch: 'feature/test',
      });
      const data = JSON.parse(result);

      expect(data.state).toBe('failure');
      expect(data.summary.statuses.failing).toBe(1);
      expect(data.summary.checkRuns.failing).toBe(1);
      expect(data.summary.workflowRuns.failing).toBe(1);
    });
  });

  describe('createFinanceSkill', () => {
    it('should create finance skill with 2 tools', () => {
      const skill = createFinanceSkill();
      expect(skill.id).toBe('finance');
      expect(skill.tools).toHaveLength(2);
      expect(skill.tools.map((t) => t.name)).toEqual(['stock_quote', 'crypto_price']);
    });

    it('stock_quote should return data', async () => {
      mockGetSecure.mockResolvedValue('av-key');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          'Global Quote': {
            '01. symbol': 'AAPL',
            '05. price': '150.00',
            '09. change': '2.00',
            '10. change percent': '1.35%',
            '06. volume': '50000000',
          },
        }),
      });

      const skill = createFinanceSkill();
      const result = await skill.tools[0].handler!({ symbol: 'AAPL' });
      const data = JSON.parse(result);
      expect(data).toBeDefined();
    });

    it('stock_quote should throw if no API key', async () => {
      mockGetSecure.mockResolvedValue(null);
      const skill = createFinanceSkill();
      await expect(skill.tools[0].handler!({ symbol: 'AAPL' })).rejects.toThrow('not configured');
    });

    it('crypto_price should return data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { usd: 50000 } }),
      });

      const skill = createFinanceSkill();
      const result = await skill.tools[1].handler!({ symbol: 'bitcoin' });
      const data = JSON.parse(result);
      expect(data).toBeDefined();
    });

    it('crypto_price should handle API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });
      const skill = createFinanceSkill();
      await expect(skill.tools[1].handler!({ symbol: 'bitcoin' })).rejects.toThrow();
    });
  });

  describe('registerBuiltInServiceSkills', () => {
    it('should register 7 skills', () => {
      registerBuiltInServiceSkills();
      expect(registerSkill).toHaveBeenCalledTimes(7);
    });
  });

  describe('createKnowledgeSkill — non-Error throw handling', () => {
    it('wikipedia_summary handles non-Error thrown value', async () => {
      mockFetch.mockRejectedValueOnce('DNS failure');
      const skill = createKnowledgeSkill();
      const result = await skill.tools[0].handler!({ topic: 'test' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('DNS failure');
    });

    it('define_word handles non-Error thrown value', async () => {
      mockFetch.mockRejectedValueOnce(42);
      const skill = createKnowledgeSkill();
      const result = await skill.tools[1].handler!({ word: 'test' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('42');
    });
  });
});
