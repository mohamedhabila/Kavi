import {
  installServiceIntegrationsReset,
  createGitHubSkill,
  mockFetch,
  mockGetSecure,
} from '../helpers/serviceIntegrationsHarness';

describe('Service Integrations', () => {
  installServiceIntegrationsReset();

  describe('createGitHubSkill', () => {
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
});
