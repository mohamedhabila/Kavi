import {
  account,
  directProject,
  mockExpoEasHarnessState,
  mockExpoGraphql,
  mockGetSecure,
  resetExpoEasMocks,
} from '../helpers/expoEasHarness';
import { createExpoProject } from '../../src/services/expo/projectCreation';
import { listExpoProjects, syncExpoAccountProjects } from '../../src/services/expo/projectSync';
import { resolveExpoProjectForExecutionTask } from '../../src/services/expo/projectResolution';
import { runExpoGraphqlQuery } from '../../src/services/expo/rawGraphql';

describe('expo eas graphql, sync, and project creation', () => {
  beforeEach(() => {
    resetExpoEasMocks();
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
    mockExpoEasHarnessState.settingsState = {
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
    mockExpoEasHarnessState.settingsState = {
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
    expect(mockExpoEasHarnessState.settingsState.expoAccounts[0]).toEqual(
      expect.objectContaining({
        syncedProjectCount: 2,
        lastProjectSyncError: undefined,
      }),
    );
    expect(mockExpoEasHarnessState.settingsState.expoProjects).toEqual(
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

  it('resolves an existing execution project by linked repository without creating a new project', async () => {
    mockExpoEasHarnessState.settingsState = {
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

  it('creates an Expo project on the server and syncs it back into local settings', async () => {
    mockExpoEasHarnessState.settingsState = {
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
