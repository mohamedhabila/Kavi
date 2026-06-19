import {
  installServiceIntegrationsReset,
  createGitHubSkill,
  mockFetch,
  mockGetSecure,
} from '../helpers/serviceIntegrationsHarness';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('createGitHubSkill', () => {
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
        labels: ['bug', 'urgent'],
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
  });
});
