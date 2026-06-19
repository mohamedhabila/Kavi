import { createExpoProject } from '../../src/services/expo/projectCreation';
import {
  getExpoAutomationSummary,
  getExpoProjectReadiness,
} from '../../src/services/expo/projectAutomation';
import { resolveExpoProject } from '../../src/services/expo/projectState';
import {
  listExpoProjects,
  syncExpoAccountProjects,
} from '../../src/services/expo/projectSync';
import { resolveExpoProjectForExecutionTask } from '../../src/services/expo/projectResolution';
import { buildExpoDeployWorkflowTemplate } from '../../src/services/expo/workflowSelection';
import {
  probeExpoProject,
  runExpoProjectAction,
} from '../../src/services/expo/workflowActions';
import { runExpoGraphqlQuery } from '../../src/services/expo/rawGraphql';
import {
  inspectExpoWorkflowRun,
  listExpoWorkflowRuns,
  waitForExpoWorkflowRun,
} from '../../src/services/expo/workflowMonitoring';
import {
  excerptWorkflowLogText,
  looksCompressed,
  stripAnsiAndControlChars,
} from '../../src/services/expo/logs/workflowText';
import { gzipSync, strToU8, zipSync } from 'fflate';

const brotliJs = require('brotli-js') as {
  compressArray(input: Uint8Array, level?: number): ArrayLike<number>;
};

function createHeaderBag(entries?: Record<string, string>) {
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

function latin1Bytes(body: string): Uint8Array {
  return Uint8Array.from(Array.from(body, (char) => char.charCodeAt(0) & 0xff));
}

function mockByteResponse(bytes: Uint8Array, headers?: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    headers: createHeaderBag(headers),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as any;
}

/** Helper: create a mock fetch Response whose arrayBuffer() returns the given string as UTF-8 bytes. */
function mockTextResponse(body: string) {
  const bytes = strToU8(body);
  return mockByteResponse(bytes, { 'content-type': 'application/x-ndjson; charset=utf-8' });
}

/** Helper: create a mock fetch Response whose arrayBuffer() returns gzip-compressed UTF-8 bytes. */
function mockGzipResponse(body: string) {
  const compressed = gzipSync(strToU8(body));
  return mockByteResponse(compressed, {
    'content-encoding': 'gzip',
    'content-type': 'application/x-ndjson; charset=utf-8',
  });
}

function mockBrotliResponse(body: string) {
  const compressed = Uint8Array.from(brotliJs.compressArray(strToU8(body), 6));
  return mockByteResponse(compressed, {
    'content-encoding': 'br',
    'content-type': 'application/x-ndjson; charset=utf-8',
  });
}

const mockGetSecure = jest.fn();
const mockExecuteSshCommand = jest.fn();
const mockStartRemoteJob = jest.fn().mockReturnValue('remote-job-1');
const mockUpdateRemoteJob = jest.fn();
const mockAddRemoteArtifact = jest.fn();
let mockSettingsState: any;

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
    getState: () => mockSettingsState,
    setState: (updater: any) => {
      mockSettingsState =
        typeof updater === 'function'
          ? { ...mockSettingsState, ...updater(mockSettingsState) }
          : { ...mockSettingsState, ...updater };
    },
  },
}));

function createSettingsState() {
  return {
    expoAccounts: [
      {
        id: 'expo-account-1',
        name: 'Expo Prod',
        owner: 'kavi',
        tokenRef: 'expo_account_token_expo-account-1',
        enabled: true,
      },
    ],
    expoProjects: [
      {
        id: 'expo-project-1',
        easProjectId: 'eas-project-1',
        name: 'Kavi',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'kavi-app',
        enabled: true,
        mode: 'direct-ssh',
        sshTargetId: 'ssh-1',
        projectPath: '/srv/kavi-app',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        platforms: ['android', 'ios', 'web'],
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

describe('expo eas service', () => {
  const directProject = {
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

  const account = {
    id: 'expo-account-1',
    name: 'Expo Prod',
    owner: 'kavi',
    tokenRef: 'expo_account_token_expo-account-1',
    enabled: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsState = createSettingsState();
    mockGetSecure.mockImplementation(async (key: string) => {
      if (key === 'expo_account_token_expo-account-1') return 'expo-token';
      if (key === 'GITHUB_TOKEN') return 'github-token';
      return null;
    });
    mockExecuteSshCommand.mockResolvedValue('builder');
    global.fetch = jest.fn() as any;
  });

  function mockExpoGraphql(
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

  it('resolves project full names using the linked account owner when the project owner is blank', () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          ...directProject,
          owner: '',
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

    expect(resolveExpoProject('@kavi/kavi-app', mockSettingsState).id).toBe('expo-project-1');
  });

  it('marks direct mode ready when account, token, ssh target, and path exist', () => {
    expect(
      getExpoProjectReadiness(directProject, account, {
        sshTargets: [{ id: 'ssh-1', enabled: true }] as any,
      }),
    ).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('marks github-workflow mode not ready when githubTokenRef is missing', () => {
    const workflowProject = {
      id: 'expo-wf',
      name: 'Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      mode: 'github-workflow' as const,
      repoFullName: 'kavi/mobile',
      workflowFile: '.github/workflows/eas.yml',
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
      // No githubTokenRef
    };
    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: false,
      reason: 'missing-github-token',
    });
  });

  it('falls back to Expo-hosted workflows for synced projects with stale github mode', () => {
    const workflowProject = {
      id: 'expo-synced-workflow',
      easProjectId: 'eas-project-synced',
      name: 'Synced Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      source: 'account-sync' as const,
      mode: 'github-workflow' as const,
      repoFullName: 'kavi/mobile',
      availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
      workflowFile: '.eas/workflows/deploy-to-production.yml',
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
    };

    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('marks github-workflow mode ready when githubTokenRef is present', () => {
    const workflowProject = {
      id: 'expo-wf',
      name: 'Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      mode: 'github-workflow' as const,
      repoFullName: 'kavi/mobile',
      workflowFile: '.github/workflows/eas.yml',
      githubTokenRef: 'GITHUB_TOKEN',
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
    };
    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('marks eas-workflow mode ready when a linked repo and workflow are available', () => {
    const workflowProject = {
      id: 'expo-eas-workflow',
      easProjectId: 'eas-project-3',
      name: 'Hosted Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      mode: 'eas-workflow' as const,
      repoFullName: 'kavi/mobile',
      workflowFile: '.eas/workflows/deploy-to-production.yml',
      availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
    };

    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('builds the official Expo deploy workflow template for a target branch', () => {
    const template = buildExpoDeployWorkflowTemplate('release');

    expect(template.path).toBe('.eas/workflows/deploy.yml');
    expect(template.branch).toBe('release');
    expect(template.content).toContain("branches: ['release']");
    expect(template.content).toContain('type: deploy');
    expect(template.content).toContain('environment: production');
    expect(template.note).toContain('Manual eas workflow:run is optional');
  });

  it('summarizes commit-driven Expo automation and suggests deploy.yml when needed', () => {
    const automation = getExpoAutomationSummary(
      {
        id: 'expo-project-web',
        name: 'Web Project',
        owner: 'kavi',
        slug: 'web-project',
        mode: 'eas-workflow',
        repoFullName: 'kavi/mobile',
        workflowFile: '.eas/workflows/build.yml',
        availableWorkflowFiles: ['.eas/workflows/build.yml'],
        workflowRef: 'release',
        repoDefaultBranch: 'main',
        platforms: ['web'],
      } as any,
      account,
    );

    expect(automation.preferredFlow).toBe('commit-driven-eas-workflow');
    expect(automation.autoTriggerOnPush).toBe(true);
    expect(automation.repoLinked).toBe(true);
    expect(automation.workflowFile).toBe('.eas/workflows/build.yml');
    expect(automation.recommendedBranch).toBe('release');
    expect(automation.recommendedMonitoringTools).toEqual([
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
    ]);
    expect(automation.deployWorkflow).toEqual(
      expect.objectContaining({
        path: '.eas/workflows/deploy.yml',
        branch: 'release',
      }),
    );
    expect(automation.recommendedFlow.join(' ')).toContain('Push a commit to release');
  });

  it('runs a direct SSH-backed build', async () => {
    mockExecuteSshCommand.mockResolvedValue('Build queued');
    const result = await runExpoProjectAction('expo-project-1', 'build', { platform: 'android' });

    expect(result.mode).toBe('direct-ssh');
    expect(mockExecuteSshCommand).toHaveBeenCalledTimes(2);
    expect(mockExecuteSshCommand.mock.calls[0][1]).toContain('eas-cli@latest whoami');
    expect(mockExecuteSshCommand.mock.calls[1][1]).toContain('eas-cli@latest build');
    expect(mockUpdateRemoteJob).toHaveBeenCalledWith(
      'remote-job-1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(mockAddRemoteArtifact).toHaveBeenCalledWith(
      'remote-job-1',
      expect.objectContaining({ kind: 'log-snippet' }),
    );
  });

  it('probes a direct project through SSH-backed whoami', async () => {
    mockExecuteSshCommand.mockResolvedValue('kavi');
    const result = await probeExpoProject('expo-project-1');
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(4);
    expect(result.message).toContain('kavi');
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

  it('returns Expo-hosted build-stage logs for failed build jobs', async () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-hosted-build-logs',
          easProjectId: 'eas-project-hosted-build-logs',
          name: 'Hosted Build Logs',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/build.yml',
          availableWorkflowFiles: ['.eas/workflows/build.yml'],
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.expo.dev/graphql') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.query.includes('query ExpoProjectWorkflows')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                app: {
                  byId: {
                    workflows: [
                      {
                        id: 'workflow-1',
                        name: 'Build',
                        fileName: '.eas/workflows/build.yml',
                        revisionsPaginated: { edges: [{ node: { id: 'revision-1' } }] },
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-build-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-build-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: { build_id: 'build-123' },
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-1',
                          logFileUrls: ['https://logs.expo.dev/build-job.ndjson'],
                          errors: [],
                        },
                        turtleBuild: {
                          id: 'build-123',
                          status: 'ERRORED',
                          logFiles: ['https://logs.expo.dev/build-log.ndjson'],
                          error: {
                            errorCode: 'UNKNOWN',
                            message: 'Gradle task assembleRelease failed with exit code 1',
                          },
                        },
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }
      }

      if (url === 'https://logs.expo.dev/build-job.ndjson') {
        return mockTextResponse(
          [
            JSON.stringify({
              phase: 'INSTALL_DEPENDENCIES',
              time: '2026-01-02T00:01:00Z',
              msg: 'npm ci',
            }),
            JSON.stringify({
              phase: 'INSTALL_DEPENDENCIES',
              time: '2026-01-02T00:01:04Z',
              msg: 'npm ERR! 404 @kavi/private-package not found',
            }),
            JSON.stringify({
              phase: 'INSTALL_DEPENDENCIES',
              marker: 'END_PHASE',
              result: 'fail',
              time: '2026-01-02T00:01:05Z',
              msg: 'Command failed with exit code 1',
            }),
          ].join('\n'),
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-hosted-build-logs', {
      workflowRunId: 'workflow-run-build-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.jobs?.[0]).toEqual(
      expect.objectContaining({
        name: 'Build',
        status: 'FAILURE',
      }),
    );
    expect(inspection.jobs?.[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Install Dependencies',
          conclusion: 'failure',
        }),
      ]),
    );
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('@kavi/private-package not found'),
        }),
      ]),
    );
    expect(inspection.guidance).toContain('missing or unresolved dependencies');
  });

  it('falls back to Expo build logFiles when workflow job logs are unavailable', async () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-hosted-build-logfiles',
          easProjectId: 'eas-project-hosted-build-logfiles',
          name: 'Hosted Build Log Files',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/build.yml',
          availableWorkflowFiles: ['.eas/workflows/build.yml'],
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.expo.dev/graphql') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.query.includes('query ExpoProjectWorkflows')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                app: {
                  byId: {
                    workflows: [
                      {
                        id: 'workflow-1',
                        name: 'Build',
                        fileName: '.eas/workflows/build.yml',
                        revisionsPaginated: { edges: [{ node: { id: 'revision-1' } }] },
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-build-2',
                    status: 'FAILURE',
                    createdAt: '2026-01-03T00:00:00Z',
                    updatedAt: '2026-01-03T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-build-2',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: { build_id: 'build-456' },
                        errors: [],
                        createdAt: '2026-01-03T00:00:05Z',
                        updatedAt: '2026-01-03T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-2',
                          logFileUrls: [],
                          errors: [],
                        },
                        turtleBuild: {
                          id: 'build-456',
                          status: 'ERRORED',
                          logFiles: [],
                          error: {
                            errorCode: 'UNKNOWN',
                            message: 'Metro encountered an error',
                          },
                        },
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        if (body.query.includes('query ExpoBuildLogFilesById')) {
          expect(body.variables).toEqual({ buildId: 'build-456' });
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                builds: {
                  byId: {
                    id: 'build-456',
                    logFiles: ['https://logs.expo.dev/build-fallback.ndjson'],
                  },
                },
              },
            }),
          } as any;
        }
      }

      if (url === 'https://logs.expo.dev/build-fallback.ndjson') {
        return mockTextResponse(
          [
            JSON.stringify({
              phase: 'EAS_BUILD_INTERNAL',
              time: '2026-01-03T00:02:00Z',
              msg: 'Metro bundling release build',
            }),
            JSON.stringify({
              phase: 'EAS_BUILD_INTERNAL',
              time: '2026-01-03T00:02:15Z',
              msg: 'error Unable to resolve module ./missing from App.tsx',
            }),
            JSON.stringify({
              phase: 'EAS_BUILD_INTERNAL',
              marker: 'END_PHASE',
              result: 'failed',
              time: '2026-01-03T00:02:16Z',
              msg: 'Metro encountered an error',
            }),
          ].join('\n'),
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-hosted-build-logfiles', {
      workflowRunId: 'workflow-run-build-2',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Eas Build Internal',
          excerpt: expect.stringContaining('Unable to resolve module ./missing'),
        }),
      ]),
    );
  });

  it('returns Expo-hosted failure diagnostics in workflow status', async () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-hosted-status',
          easProjectId: 'eas-project-hosted-status',
          name: 'Hosted Workflow Status',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    mockExpoGraphql((body) => {
      if (body.query.includes('query WorkflowRunByIdWithJobs')) {
        return {
          data: {
            workflowRuns: {
              byId: {
                id: 'workflow-run-77',
                status: 'FAILURE',
                createdAt: '2026-01-04T00:00:00Z',
                updatedAt: '2026-01-04T00:05:00Z',
                errors: [
                  {
                    title: 'Build failed',
                    message: 'Gradle task assembleRelease failed with exit code 1',
                  },
                ],
                jobs: [],
              },
            },
          },
        };
      }

      return { data: {} };
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-hosted-status', {
      workflowRunId: 'workflow-run-77',
    });

    expect(inspection).toEqual(
      expect.objectContaining({
        status: 'ok',
        failureLogs: [
          expect.objectContaining({
            source: 'Build failed',
            excerpt: expect.stringContaining('Gradle task assembleRelease failed'),
          }),
        ],
      }),
    );
  });

  it('returns structured unsupported results when github workflow metadata is incomplete', async () => {
    mockSettingsState = {
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
    mockSettingsState = {
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

  it('runs raw Expo GraphQL queries with the resolved project account token', async () => {
    mockExpoGraphql((body) => {
      expect(body.query).toContain('__typename');
      expect(body.variables).toEqual({ appId: 'eas-project-1' });
      return { data: { __typename: 'Query' } };
    });

    const result = await runExpoGraphqlQuery({
      projectId: 'expo-project-1',
      query: 'query Introspect($appId: ID!) { __typename }',
      variables: { appId: 'eas-project-1' },
    });

    expect(result.status).toBe('ok');
    expect(result.projectId).toBe('expo-project-1');
    expect(result.accountId).toBe('expo-account-1');
    expect(result.data).toEqual({ __typename: 'Query' });
  });

  it('returns partial raw GraphQL results instead of throwing when Expo reports field errors', async () => {
    mockExpoGraphql(() => ({
      data: { app: { id: 'eas-project-1' } },
      errors: [
        {
          message: 'Unknown field "branch" on type "App"',
          path: ['app', 'branch'],
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        },
      ],
    }));

    const result = await runExpoGraphqlQuery({
      projectId: 'expo-project-1',
      query: 'query { app { id branch } }',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'partial',
        accountId: 'expo-account-1',
        projectId: 'expo-project-1',
        data: { app: { id: 'eas-project-1' } },
        error: expect.stringContaining('Unknown field "branch" on type "App"'),
        errors: [
          expect.objectContaining({
            message: 'Unknown field "branch" on type "App"',
            path: 'app.branch',
            code: 'GRAPHQL_VALIDATION_FAILED',
          }),
        ],
      }),
    );
  });

  it('infers the target project account for raw GraphQL queries from appId variables', async () => {
    mockSettingsState = {
      expoAccounts: [
        account,
        {
          id: 'expo-account-2',
          name: 'Expo Labs',
          owner: 'kavi-labs',
          tokenRef: 'expo_account_token_expo-account-2',
          enabled: true,
        },
      ],
      expoProjects: [
        {
          ...directProject,
          easProjectId: 'eas-project-1',
        },
        {
          id: 'expo-project-9',
          easProjectId: 'eas-project-9',
          name: 'Labs App',
          accountId: 'expo-account-2',
          owner: 'kavi-labs',
          slug: 'labs-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi-labs/mobile',
          workflowFile: '.eas/workflows/deploy.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
          platforms: ['android'],
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
    mockGetSecure.mockImplementation(async (key: string) => {
      if (key === 'expo_account_token_expo-account-1') return 'expo-token';
      if (key === 'expo_account_token_expo-account-2') return 'expo-token-2';
      if (key === 'GITHUB_TOKEN') return 'github-token';
      return null;
    });

    mockExpoGraphql((body) => {
      expect(body.variables).toEqual({ appId: 'eas-project-9' });
      return { data: { app: { byId: { id: 'eas-project-9' } } } };
    });

    const result = await runExpoGraphqlQuery({
      query: 'query Introspect($appId: ID!) { app { byId(appId: $appId) { id } } }',
      variables: { appId: 'eas-project-9' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        accountId: 'expo-account-2',
        projectId: 'expo-project-9',
        data: { app: { byId: { id: 'eas-project-9' } } },
      }),
    );
  });

  it('returns a structured context error when multiple Expo accounts are enabled and no target can be inferred', async () => {
    mockSettingsState = {
      expoAccounts: [
        account,
        {
          id: 'expo-account-2',
          name: 'Expo Labs',
          owner: 'kavi-labs',
          tokenRef: 'expo_account_token_expo-account-2',
          enabled: true,
        },
      ],
      expoProjects: [],
      sshTargets: [],
    };

    const result = await runExpoGraphqlQuery({ query: 'query { __typename }' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'error',
        error: 'expo-account-ambiguous',
        errorCode: 'expo-account-ambiguous',
        guidance: expect.stringContaining('Pass projectId or accountId'),
      }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
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
    mockSettingsState = {
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

    mockSettingsState = {
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

  it('syncs account projects from Expo and promotes repo-linked workflows to Expo-hosted execution', async () => {
    mockExpoGraphql((body) => {
      if (body.query.includes('query ExpoAccountProjects')) {
        return {
          data: {
            account: {
              byName: {
                id: 'expo-account-1',
                apps: [
                  {
                    id: 'eas-project-1',
                    name: 'Kavi',
                    fullName: '@kavi/kavi-app',
                    slug: 'kavi-app',
                    ownerAccount: { id: 'expo-account-1', name: 'kavi' },
                    githubRepository: {
                      metadata: { githubRepoOwnerName: 'kavi', githubRepoName: 'mobile' },
                    },
                  },
                  {
                    id: 'eas-project-3',
                    name: 'Kavi Admin',
                    fullName: '@kavi/kavi-admin',
                    slug: 'kavi-admin',
                    ownerAccount: { id: 'expo-account-1', name: 'kavi' },
                    githubRepository: {
                      metadata: { githubRepoOwnerName: 'kavi', githubRepoName: 'admin' },
                    },
                  },
                ],
              },
            },
          },
        };
      }

      if (
        body.query.includes('query ExpoProjectWorkflows') &&
        body.variables?.appId === 'eas-project-1'
      ) {
        return {
          data: {
            app: {
              byId: {
                workflows: [
                  {
                    id: 'workflow-1',
                    name: 'Deploy to production',
                    fileName: '.eas/workflows/deploy-to-production.yml',
                    revisionsPaginated: { edges: [{ node: { id: 'revision-1' } }] },
                  },
                ],
              },
            },
          },
        };
      }

      if (
        body.query.includes('query ExpoProjectWorkflows') &&
        body.variables?.appId === 'eas-project-3'
      ) {
        return {
          data: {
            app: {
              byId: {
                workflows: [],
              },
            },
          },
        };
      }

      return { data: {} };
    });

    const result = await syncExpoAccountProjects('expo-account-1');

    expect(result.projectCount).toBe(2);
    expect(mockSettingsState.expoAccounts[0]).toEqual(
      expect.objectContaining({
        syncedProjectCount: 2,
        lastProjectSyncError: undefined,
      }),
    );
    expect(mockSettingsState.expoProjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'expo-project-1',
          easProjectId: 'eas-project-1',
          mode: 'eas-workflow',
          projectPath: '/srv/kavi-app',
          sshTargetId: 'ssh-1',
          repoFullName: 'kavi/mobile',
          availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
          source: 'account-sync',
        }),
        expect.objectContaining({
          id: 'eas-project-3',
          easProjectId: 'eas-project-3',
          mode: 'eas-workflow',
          slug: 'kavi-admin',
          owner: 'kavi',
          source: 'account-sync',
        }),
      ]),
    );
  });

  it('lists synced projects and can refresh them before returning the list', async () => {
    mockExpoGraphql((body) => {
      if (body.query.includes('query ExpoAccountProjects')) {
        return {
          data: {
            account: {
              byName: {
                id: 'expo-account-1',
                apps: [
                  {
                    id: 'eas-project-1',
                    name: 'Kavi',
                    fullName: '@kavi/kavi-app',
                    slug: 'kavi-app',
                    ownerAccount: { id: 'expo-account-1', name: 'kavi' },
                    githubRepository: {
                      metadata: { githubRepoOwnerName: 'kavi', githubRepoName: 'mobile' },
                    },
                  },
                ],
              },
            },
          },
        };
      }

      if (body.query.includes('query ExpoProjectWorkflows')) {
        return {
          data: {
            app: {
              byId: {
                workflows: [
                  {
                    id: 'workflow-1',
                    name: 'Deploy to production',
                    fileName: '.eas/workflows/deploy-to-production.yml',
                    revisionsPaginated: { edges: [{ node: { id: 'revision-1' } }] },
                  },
                ],
              },
            },
          },
        };
      }

      return { data: {} };
    });

    const projects = await listExpoProjects({ refresh: true });

    expect(projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'expo-project-1',
          easProjectId: 'eas-project-1',
          fullName: '@kavi/kavi-app',
          accountName: 'Expo Prod',
          mode: 'eas-workflow',
          availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
        }),
      ]),
    );
  });

  it('runs synced stale github-mode projects through Expo-hosted workflows when available', async () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-synced',
          easProjectId: 'eas-project-synced',
          name: 'Synced Workflow',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          source: 'account-sync',
          mode: 'github-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy-to-production.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
          workflowRef: 'main',
          defaultBuildProfile: 'production',
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    mockExpoGraphql((body) => {
      if (body.query.includes('query ExpoProjectWorkflows')) {
        return {
          data: {
            app: {
              byId: {
                workflows: [
                  {
                    id: 'workflow-1',
                    name: 'Deploy to production',
                    fileName: '.eas/workflows/deploy-to-production.yml',
                    revisionsPaginated: { edges: [{ node: { id: 'revision-1' } }] },
                  },
                ],
              },
            },
          },
        };
      }

      if (body.query.includes('mutation GetOrCreateWorkflowRevisionFromGitRef')) {
        return {
          data: {
            workflowRevision: {
              getOrCreateWorkflowRevisionFromGitRef: { id: 'revision-1' },
            },
          },
        };
      }

      if (body.query.includes('mutation CreateWorkflowRunFromGitRef')) {
        return {
          data: {
            workflowRun: {
              createWorkflowRunFromGitRef: { id: 'workflow-run-1' },
            },
          },
        };
      }

      if (body.query.includes('query WorkflowRunById')) {
        return {
          data: {
            workflowRuns: {
              byId: {
                id: 'workflow-run-1',
                status: 'SUCCESS',
                errors: [],
              },
            },
          },
        };
      }

      return { data: {} };
    });

    const result = await runExpoProjectAction('expo-project-synced', 'build', {
      platform: 'android',
      waitForCompletion: true,
    });

    expect(result.mode).toBe('eas-workflow');
    expect(
      (global.fetch as jest.Mock).mock.calls.some(([url]) =>
        String(url).includes('api.github.com'),
      ),
    ).toBe(false);
  });

  it('resolves an existing execution project by linked repository without creating a new project', async () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-linked',
          easProjectId: 'eas-project-linked',
          name: 'Linked Workflow',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'linked-workflow',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy.yml',
          platforms: ['web'],
        },
      ],
      sshTargets: [],
    };

    const resolution = await resolveExpoProjectForExecutionTask({
      repoFullName: 'KAVI/MOBILE',
      allowSync: false,
    });

    expect(resolution.status).toBe('resolved');
    expect(resolution.status === 'resolved' ? resolution.project.id : undefined).toBe(
      'expo-project-linked',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps Expo sync pagination within the server limit', async () => {
    mockExpoGraphql((body) => {
      if (body.query.includes('query ExpoAccountProjects') && body.variables?.offset === 0) {
        return {
          data: {
            account: {
              byName: {
                id: 'expo-account-1',
                apps: Array.from({ length: 50 }, (_, index) => ({
                  id: `eas-project-${index + 1}`,
                  name: `Project ${index + 1}`,
                  fullName: `@kavi/project-${index + 1}`,
                  slug: `project-${index + 1}`,
                  ownerAccount: { id: 'expo-account-1', name: 'kavi' },
                })),
              },
            },
          },
        };
      }

      if (body.query.includes('query ExpoAccountProjects') && body.variables?.offset === 50) {
        return {
          data: {
            account: {
              byName: {
                id: 'expo-account-1',
                apps: [
                  {
                    id: 'eas-project-51',
                    name: 'Project 51',
                    fullName: '@kavi/project-51',
                    slug: 'project-51',
                    ownerAccount: { id: 'expo-account-1', name: 'kavi' },
                  },
                ],
              },
            },
          },
        };
      }

      if (body.query.includes('query ExpoProjectWorkflows')) {
        return {
          data: {
            app: {
              byId: {
                workflows: [],
              },
            },
          },
        };
      }

      return { data: {} };
    });

    const result = await syncExpoAccountProjects('expo-account-1');

    expect(result.projectCount).toBe(51);
    const requestBodies = (global.fetch as jest.Mock).mock.calls
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
      .filter((body) => String(body.query || '').includes('query ExpoAccountProjects'));
    expect(requestBodies).toEqual([
      expect.objectContaining({ variables: expect.objectContaining({ limit: 50, offset: 0 }) }),
      expect.objectContaining({ variables: expect.objectContaining({ limit: 50, offset: 50 }) }),
    ]);
  });

  it('runs an Expo-hosted workflow build using only the Expo token', async () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-hosted',
          easProjectId: 'eas-project-hosted',
          name: 'Hosted Build',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy-to-production.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
          workflowRef: 'main',
          defaultBuildProfile: 'production',
          defaultUpdateBranch: 'production',
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    mockExpoGraphql((body) => {
      if (body.query.includes('query ExpoProjectWorkflows')) {
        return {
          data: {
            app: {
              byId: {
                workflows: [
                  {
                    id: 'workflow-1',
                    name: 'Deploy to production',
                    fileName: '.eas/workflows/deploy-to-production.yml',
                    revisionsPaginated: { edges: [{ node: { id: 'revision-1' } }] },
                  },
                ],
              },
            },
          },
        };
      }

      if (body.query.includes('mutation GetOrCreateWorkflowRevisionFromGitRef')) {
        return {
          data: {
            workflowRevision: {
              getOrCreateWorkflowRevisionFromGitRef: { id: 'revision-1' },
            },
          },
        };
      }

      if (body.query.includes('mutation CreateWorkflowRunFromGitRef')) {
        return {
          data: {
            workflowRun: {
              createWorkflowRunFromGitRef: { id: 'workflow-run-1' },
            },
          },
        };
      }

      if (body.query.includes('query WorkflowRunById')) {
        return {
          data: {
            workflowRuns: {
              byId: {
                id: 'workflow-run-1',
                status: 'SUCCESS',
                errors: [],
              },
            },
          },
        };
      }

      return { data: {} };
    });

    const result = await runExpoProjectAction('expo-project-hosted', 'build', {
      platform: 'android',
      waitForCompletion: true,
    });

    expect(result.mode).toBe('eas-workflow');
    expect(result.workflowRun).toEqual(
      expect.objectContaining({
        id: 'workflow-run-1',
        status: 'SUCCESS',
      }),
    );
    expect(mockUpdateRemoteJob).toHaveBeenCalledWith(
      'remote-job-1',
      expect.objectContaining({ status: 'completed', externalId: 'workflow-run-1' }),
    );
  });

  it('creates an Expo project on the server and syncs it back into local settings', async () => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [],
      sshTargets: [],
    };

    mockExpoGraphql((body) => {
      if (body.query.includes('query ExpoProjectByFullName')) {
        return { data: { app: { byFullName: null } } };
      }

      if (body.query.includes('query ExpoAccountByName')) {
        return { data: { account: { byName: { id: 'remote-account-1', name: 'kavi' } } } };
      }

      if (body.query.includes('mutation CreateExpoProject')) {
        return { data: { app: { createApp: { id: 'eas-project-created' } } } };
      }

      if (body.query.includes('query ExpoAccountProjects')) {
        return {
          data: {
            account: {
              byName: {
                id: 'expo-account-1',
                apps: [
                  {
                    id: 'eas-project-created',
                    name: 'New Project',
                    fullName: '@kavi/new-project',
                    slug: 'new-project',
                    ownerAccount: { id: 'expo-account-1', name: 'kavi' },
                    githubRepository: {
                      metadata: { githubRepoOwnerName: 'kavi', githubRepoName: 'mobile' },
                    },
                  },
                ],
              },
            },
          },
        };
      }

      if (body.query.includes('query ExpoProjectWorkflows')) {
        return {
          data: {
            app: {
              byId: {
                workflows: [
                  {
                    id: 'workflow-1',
                    name: 'Deploy to production',
                    fileName: '.eas/workflows/deploy-to-production.yml',
                    revisionsPaginated: { edges: [{ node: { id: 'revision-1' } }] },
                  },
                ],
              },
            },
          },
        };
      }

      return { data: {} };
    });

    const project = await createExpoProject({ name: 'New Project' });

    expect(project.fullName).toBe('@kavi/new-project');
    expect(project.mode).toBe('eas-workflow');
    expect(project.availableWorkflowFiles).toEqual(['.eas/workflows/deploy-to-production.yml']);
  });
});

describe('looksCompressed', () => {
  it('detects gzip magic bytes', () => {
    expect(looksCompressed(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);
  });

  it('detects zlib header 0x78 0x9c', () => {
    expect(looksCompressed(new Uint8Array([0x78, 0x9c, 0x01, 0x00]))).toBe(true);
  });

  it('detects zlib header 0x78 0x01', () => {
    expect(looksCompressed(new Uint8Array([0x78, 0x01, 0x01, 0x00]))).toBe(true);
  });

  it('detects zlib header 0x78 0xda', () => {
    expect(looksCompressed(new Uint8Array([0x78, 0xda, 0x01, 0x00]))).toBe(true);
  });

  it('returns false for plain text bytes', () => {
    expect(looksCompressed(strToU8('Hello world'))).toBe(false);
  });

  it('returns false for JSON bytes', () => {
    expect(looksCompressed(strToU8('{"msg":"test"}'))).toBe(false);
  });

  it('returns false for too-short buffers', () => {
    expect(looksCompressed(new Uint8Array([0x1f]))).toBe(false);
    expect(looksCompressed(new Uint8Array([]))).toBe(false);
  });
});

describe('stripAnsiAndControlChars', () => {
  it('strips ANSI color escape sequences', () => {
    expect(stripAnsiAndControlChars('\x1b[31mError\x1b[0m: something failed')).toBe(
      'Error: something failed',
    );
  });

  it('strips ANSI bold/underline sequences', () => {
    expect(stripAnsiAndControlChars('\x1b[1mBold\x1b[4mUnderline\x1b[0m')).toBe('BoldUnderline');
  });

  it('strips null bytes and other control chars', () => {
    expect(stripAnsiAndControlChars('line1\x00\x01\x02line2')).toBe('line1line2');
  });

  it('preserves newlines, tabs, and carriage returns', () => {
    // \n (0x0a), \r (0x0d), \t (0x09) should be kept
    expect(stripAnsiAndControlChars('line1\nline2\r\nline3\ttab')).toBe(
      'line1\nline2\r\nline3\ttab',
    );
  });

  it('returns clean text unchanged', () => {
    const clean = 'npm ERR! 404 @kavi/package not found';
    expect(stripAnsiAndControlChars(clean)).toBe(clean);
  });
});

describe('excerptWorkflowLogText', () => {
  it('strips ANSI before excerpting', () => {
    const log = '\x1b[31mERROR:\x1b[0m Module not found';
    const result = excerptWorkflowLogText(log);
    expect(result).not.toContain('\x1b');
    expect(result).toContain('ERROR: Module not found');
  });

  it('focuses around error patterns', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `step ${i}`);
    lines[50] = 'fatal error: something broke';
    const result = excerptWorkflowLogText(lines.join('\n'));
    expect(result).toContain('fatal error: something broke');
  });

  it('respects maxChars limit', () => {
    const longLog = Array.from({ length: 200 }, (_, i) => `line ${i}: ${'x'.repeat(50)}`).join(
      '\n',
    );
    const result = excerptWorkflowLogText(longLog, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/…$/);
  });
});

describe('compressed log decompression', () => {
  const account = {
    id: 'expo-account-1',
    name: 'Expo Prod',
    owner: 'kavi',
    tokenRef: 'expo_account_token_expo-account-1',
    enabled: true,
  };
  let mockSettingsState: any;

  beforeEach(() => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-gzip',
          easProjectId: 'eas-project-gzip',
          name: 'Gzip Logs',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    // Re-bind the mocked settings store for this suite
    const { useSettingsStore } = require('../../src/store/useSettingsStore');
    useSettingsStore.setState(mockSettingsState);
  });

  it('decompresses gzip-compressed JSONL logs from EAS build', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:00Z',
        msg: 'yarn install',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:04Z',
        msg: 'error @kavi/gzip-test: package not found',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:01:05Z',
        msg: 'Command failed',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-gzip-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-gzip-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-gzip-1',
                          logFileUrls: ['https://logs.expo.dev/gzip-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      // Return gzip-compressed log content for the log URL
      if (url === 'https://logs.expo.dev/gzip-test.ndjson') {
        return mockGzipResponse(logContent);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-gzip', {
      workflowRunId: 'workflow-run-gzip-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('@kavi/gzip-test: package not found'),
        }),
      ]),
    );
    // Ensure excerpt is clean text, not garbled binary
    for (const log of inspection.failureLogs || []) {
      expect(log.excerpt).not.toMatch(/[\x00-\x08\x0e-\x1f]/);
    }
  });

  it('decompresses Brotli-compressed JSONL logs from Expo-hosted workflows', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:03:00Z',
        msg: 'npm ci',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:03:04Z',
        msg: 'error @kavi/brotli-test: package not found',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:03:05Z',
        msg: 'Command failed with exit code 1',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-brotli-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-brotli-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-brotli-1',
                          logFileUrls: ['https://logs.expo.dev/brotli-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      if (url === 'https://logs.expo.dev/brotli-test.ndjson') {
        return mockBrotliResponse(logContent);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-gzip', {
      workflowRunId: 'workflow-run-brotli-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('@kavi/brotli-test: package not found'),
        }),
      ]),
    );
    for (const log of inspection.failureLogs || []) {
      expect(log.excerpt).not.toMatch(/[\x00-\x08\x0e-\x1f]/);
    }
  });

  it('keeps readable log text when the runtime already decoded a Brotli response body', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:04:00Z',
        msg: 'npm ci',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:04:04Z',
        msg: 'error @kavi/br-header-test: package not found',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:04:05Z',
        msg: 'Command failed with exit code 1',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-br-header-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-br-header-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-br-header-1',
                          logFileUrls: ['https://logs.expo.dev/br-header-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      if (url === 'https://logs.expo.dev/br-header-test.ndjson') {
        return mockByteResponse(strToU8(logContent), {
          'content-encoding': 'br',
          'content-type': 'application/x-ndjson; charset=utf-8',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-gzip', {
      workflowRunId: 'workflow-run-br-header-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('@kavi/br-header-test: package not found'),
        }),
      ]),
    );
  });
});

describe('workflow log charset decoding', () => {
  const account = {
    id: 'expo-account-1',
    name: 'Expo Prod',
    owner: 'kavi',
    tokenRef: 'expo_account_token_expo-account-1',
    enabled: true,
  };

  beforeEach(() => {
    mockSettingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          id: 'expo-project-charset',
          easProjectId: 'eas-project-charset',
          name: 'Charset Logs',
          accountId: 'expo-account-1',
          owner: 'kavi',
          slug: 'kavi-app',
          enabled: true,
          mode: 'eas-workflow',
          repoFullName: 'kavi/mobile',
          workflowFile: '.eas/workflows/deploy.yml',
          availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
          platforms: ['android'],
        },
      ],
      sshTargets: [],
    };

    const { useSettingsStore } = require('../../src/store/useSettingsStore');
    useSettingsStore.setState(mockSettingsState);
  });

  it('decodes non-UTF-8 workflow log responses using the declared charset', async () => {
    const logContent = [
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:00Z',
        msg: 'npm ci',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        time: '2026-01-02T00:01:04Z',
        msg: 'error dépendance privée introuvable',
      }),
      JSON.stringify({
        phase: 'INSTALL_DEPENDENCIES',
        marker: 'END_PHASE',
        result: 'fail',
        time: '2026-01-02T00:01:05Z',
        msg: 'Command failed',
      }),
    ].join('\n');

    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('expo.dev/graphql')) {
        const body = JSON.parse(init?.body);

        if (body.query.includes('query WorkflowRunByIdWithJobs')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                workflowRuns: {
                  byId: {
                    id: 'workflow-run-charset-1',
                    status: 'FAILURE',
                    createdAt: '2026-01-02T00:00:00Z',
                    updatedAt: '2026-01-02T00:05:00Z',
                    errors: [],
                    jobs: [
                      {
                        id: 'job-charset-1',
                        key: 'build_android',
                        name: 'Build',
                        status: 'FAILURE',
                        type: 'BUILD',
                        outputs: {},
                        errors: [],
                        createdAt: '2026-01-02T00:00:05Z',
                        updatedAt: '2026-01-02T00:04:55Z',
                        turtleJobRun: {
                          id: 'job-run-charset-1',
                          logFileUrls: ['https://logs.expo.dev/latin1-test.ndjson'],
                          errors: [],
                        },
                        turtleBuild: null,
                      },
                    ],
                  },
                },
              },
            }),
          } as any;
        }

        return { ok: true, status: 200, json: async () => ({ data: {} }) } as any;
      }

      if (url === 'https://logs.expo.dev/latin1-test.ndjson') {
        return mockByteResponse(latin1Bytes(logContent), {
          'content-type': 'application/x-ndjson; charset=iso-8859-1',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const inspection = await inspectExpoWorkflowRun('expo-project-charset', {
      workflowRunId: 'workflow-run-charset-1',
    });

    expect(inspection.status).toBe('ok');
    expect(inspection.failureLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Build / Install Dependencies',
          excerpt: expect.stringContaining('dépendance privée introuvable'),
        }),
      ]),
    );
    expect(inspection.failureLogs?.some((entry) => entry.excerpt.includes('d�pendance'))).toBe(
      false,
    );
  });
});
