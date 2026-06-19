import {
  account,
  mockExpoEasHarnessState,
  mockExpoGraphql,
  mockTextResponse,
  mockUpdateRemoteJob,
  resetExpoEasMocks,
} from '../helpers/expoEasHarness';
import { runExpoProjectAction } from '../../src/services/expo/workflowActions';
import { inspectExpoWorkflowRun } from '../../src/services/expo/workflowMonitoring';

describe('expo eas hosted workflow execution and diagnostics', () => {
  beforeEach(() => {
    resetExpoEasMocks();
  });

  it('returns Expo-hosted build-stage logs for failed build jobs', async () => {
    mockExpoEasHarnessState.settingsState = {
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
    mockExpoEasHarnessState.settingsState = {
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
    mockExpoEasHarnessState.settingsState = {
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

  it('runs synced stale github-mode projects through Expo-hosted workflows when available', async () => {
    mockExpoEasHarnessState.settingsState = {
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

  it('runs an Expo-hosted workflow build using only the Expo token', async () => {
    mockExpoEasHarnessState.settingsState = {
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
});
