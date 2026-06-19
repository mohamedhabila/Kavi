import { zipSync } from 'fflate';
import {
  account,
  mockExpoEasHarnessState,
  mockGetSecure,
  mockUpdateRemoteJob,
  resetExpoEasMocks,
  strToU8,
} from '../helpers/expoEasHarness';
import { probeExpoProject, runExpoProjectAction } from '../../src/services/expo/workflowActions';
import {
  inspectExpoWorkflowRun,
  listExpoWorkflowRuns,
  waitForExpoWorkflowRun,
} from '../../src/services/expo/workflowMonitoring';

describe('expo eas github workflow execution and monitoring', () => {
  beforeEach(() => {
    resetExpoEasMocks();
  });

  it('dispatches and tracks a GitHub workflow run', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          path: '.github/workflows/eas.yml',
          state: 'active',
          name: 'EAS Deploy',
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          workflow_runs: [
            {
              id: 91,
              html_url: 'https://github.com/kavi/mobile/actions/runs/91',
              status: 'completed',
              conclusion: 'success',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      });

    const result = await runExpoProjectAction('expo-project-2', 'deploy-web', {
      waitForCompletion: true,
    });

    expect(result.mode).toBe('github-workflow');
    expect(result.workflowRun?.id).toBe(91);
    expect(result.note).toContain('manual workflow dispatch');
    expect(mockUpdateRemoteJob).toHaveBeenCalledWith(
      'remote-job-1',
      expect.objectContaining({ status: 'completed', externalId: '91' }),
    );
  });

  it('lists and inspects GitHub workflow runs with job details', async () => {
    const logArchive = zipSync({
      'build/3_Run tests.txt': strToU8(
        [
          'Running test suite',
          'npm ERR! code 1',
          'Error: expected 200 to equal 500',
          'at build (/workspace/build.js:42:13)',
        ].join('\n'),
      ),
    });

    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/actions/workflows/') && url.includes('/runs?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            workflow_runs: [
              {
                id: 101,
                html_url: 'https://github.com/kavi/mobile/actions/runs/101',
                status: 'completed',
                conclusion: 'failure',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:05:00Z',
                head_branch: 'main',
                event: 'workflow_dispatch',
              },
            ],
          }),
        } as any;
      }

      if (url.endsWith('/actions/runs/101')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 101,
            html_url: 'https://github.com/kavi/mobile/actions/runs/101',
            status: 'completed',
            conclusion: 'failure',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:05:00Z',
            head_branch: 'main',
            event: 'workflow_dispatch',
          }),
        } as any;
      }

      if (url.endsWith('/actions/runs/101/jobs?per_page=100')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jobs: [
              {
                id: 501,
                name: 'build',
                status: 'completed',
                conclusion: 'failure',
                html_url: 'https://github.com/kavi/mobile/actions/runs/101/job/501',
                started_at: '2026-01-01T00:00:10Z',
                completed_at: '2026-01-01T00:04:59Z',
                steps: [
                  {
                    number: 1,
                    name: 'Checkout',
                    status: 'completed',
                    conclusion: 'failure',
                    started_at: '2026-01-01T00:00:10Z',
                    completed_at: '2026-01-01T00:00:20Z',
                  },
                ],
              },
            ],
          }),
        } as any;
      }

      if (url.endsWith('/actions/runs/101/logs')) {
        return {
          ok: true,
          status: 200,
          url: 'https://objects.githubusercontent.com/logs/101.zip',
          headers: { get: () => null },
          arrayBuffer: async () =>
            logArchive.buffer.slice(
              logArchive.byteOffset,
              logArchive.byteOffset + logArchive.byteLength,
            ),
        } as any;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const runs = await listExpoWorkflowRuns('expo-project-2', { limit: 2 });
    expect(runs.status).toBe('ok');
    expect(runs.runs[0]).toEqual(expect.objectContaining({ id: 101, status: 'completed' }));

    const inspection = await inspectExpoWorkflowRun('expo-project-2', { workflowRunId: '101' });
    expect(inspection.status).toBe('ok');
    expect(inspection.jobs?.[0]).toEqual(
      expect.objectContaining({ name: 'build', status: 'completed' }),
    );
    expect(inspection.jobs?.[0].steps?.[0]).toEqual(expect.objectContaining({ name: 'Checkout' }));
    expect(inspection.logArchiveUrl).toBe('https://objects.githubusercontent.com/logs/101.zip');
    expect(inspection.failureLogs?.[0]).toEqual(
      expect.objectContaining({
        source: 'build/3_Run tests.txt',
        excerpt: expect.stringContaining('expected 200 to equal 500'),
      }),
    );
  });

  it('refuses to wait on an ambiguous latest workflow run without a run id', async () => {
    const waited = await waitForExpoWorkflowRun('expo-project-2', {
      timeoutMs: 1000,
      pollIntervalMs: 1000,
    });

    expect(waited).toEqual(
      expect.objectContaining({
        status: 'not_found',
        timedOut: false,
        note: expect.stringContaining('workflowRunId is required'),
      }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns structured unsupported results when github workflow metadata is incomplete', async () => {
    mockExpoEasHarnessState.settingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-broken-workflow',
          name: 'Broken Workflow',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'github-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '   ',
          githubTokenRef: 'GITHUB_TOKEN',
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    const runs = await listExpoWorkflowRuns('expo-project-broken-workflow');
    expect(runs).toEqual(
      expect.objectContaining({
        status: 'unsupported',
        note: expect.stringContaining('Add .eas/workflows/*.yml'),
        runs: [],
      }),
    );

    const inspection = await inspectExpoWorkflowRun('expo-project-broken-workflow');
    expect(inspection).toEqual(
      expect.objectContaining({
        status: 'unsupported',
        note: expect.stringContaining('Add .eas/workflows/*.yml'),
      }),
    );

    const waited = await waitForExpoWorkflowRun('expo-project-broken-workflow', {
      timeoutMs: 1000,
      pollIntervalMs: 1000,
    });
    expect(waited).toEqual(
      expect.objectContaining({
        status: 'unsupported',
        timedOut: false,
        note: expect.stringContaining('Add .eas/workflows/*.yml'),
      }),
    );

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails github workflow actions with a clean config error instead of a trim crash', async () => {
    mockExpoEasHarnessState.settingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-broken-action',
          name: 'Broken Action Workflow',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'github-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: ' ',
          githubTokenRef: 'GITHUB_TOKEN',
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    await expect(
      runExpoProjectAction('expo-project-broken-action', 'build', { platform: 'android' }),
    ).rejects.toThrow('missing-workflow-file');
  });

  it('reports workflow probe readiness from GitHub runs', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          path: '.github/workflows/eas.yml',
          state: 'active',
          name: 'EAS Deploy',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      });

    const result = await probeExpoProject('expo-project-2');
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(3);
    expect(result.message).toContain('Workflow dispatch ready');
  });

  it('probes GitHub workflow runs against the repo default branch when workflowRef is unset', async () => {
    mockExpoEasHarnessState.settingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-master',
          name: 'Master Workflow',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'github-workflow',
          repoFullName: 'kavi/mobile',
          repoDefaultBranch: 'master',
          workflowFile: '.github/workflows/eas.yml',
          githubTokenRef: 'GITHUB_TOKEN',
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          path: '.github/workflows/eas.yml',
          state: 'active',
          name: 'EAS Deploy',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          workflow_runs: [
            {
              id: 91,
              html_url: 'https://github.com/kavi/mobile/actions/runs/91',
              status: 'completed',
              conclusion: 'failure',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      });

    const result = await probeExpoProject('expo-project-master');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('last run completed');
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('branch=master');
  });

  it('uses the project-configured github token ref during workflow validation and dispatch', async () => {
    mockGetSecure.mockImplementation(async (key: string) => {
      if (key === 'expo_account_token_expo-account-1') return 'expo-token';
      if (key === 'GITHUB_TOKEN') return null;
      if (key === 'PROJECT_GITHUB_TOKEN') return 'project-token';
      return null;
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          path: '.github/workflows/eas.yml',
          state: 'active',
          name: 'EAS Deploy',
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      });

    mockExpoEasHarnessState.settingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-custom-token',
          name: 'Custom Token Workflow',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'github-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.github/workflows/eas.yml',
          workflowRef: 'main',
          githubTokenRef: 'PROJECT_GITHUB_TOKEN',
          platforms: ['ios'],
        },
      ],
      sshTargets: [],
    };

    await runExpoProjectAction('expo-project-custom-token', 'submit', {
      platform: 'ios',
      waitTimeoutMs: 1,
    });

    expect(global.fetch).toHaveBeenCalled();
    for (const [url, init] of (global.fetch as jest.Mock).mock.calls) {
      if (String(url).includes('api.github.com')) {
        expect((init as RequestInit).headers).toEqual(
          expect.objectContaining({
            Authorization: 'Bearer project-token',
          }),
        );
      }
    }
  });
});
