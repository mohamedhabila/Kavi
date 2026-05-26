// ---------------------------------------------------------------------------
// Parity Tool Executor — Expo-specific tests
// ---------------------------------------------------------------------------

const mockAutomation = {
  preferredFlow: 'commit-driven-eas-workflow' as const,
  autoTriggerOnPush: true,
  repoLinked: true,
  workflowFile: '.eas/workflows/deploy.yml',
  recommendedBranch: 'main',
  recommendedMonitoringTools: [
    'expo_eas_workflow_runs',
    'expo_eas_workflow_status',
    'expo_eas_workflow_wait',
  ],
  manualActionTools: [
    'expo_eas_build',
    'expo_eas_update',
    'expo_eas_submit',
    'expo_eas_deploy_web',
  ],
  recommendedFlow: [
    'Edit the linked repository or working branch with repository or workspace tools.',
    'Keep .eas/workflows/deploy.yml on the target branch, then commit the required app changes.',
    'Push a commit to main or another branch matched by the workflow on.push trigger.',
    'Monitor the automatically triggered run with expo_eas_workflow_runs, expo_eas_workflow_status, expo_eas_workflow_wait.',
  ],
  deployWorkflow: {
    path: '.eas/workflows/deploy.yml',
    branch: 'main',
    content: 'name: Deploy',
  },
};

const mockProject = {
  id: 'expo-project-1',
  easProjectId: 'eas-project-1',
  name: 'Kavi',
  accountId: 'expo-account-1',
  owner: 'kavi',
  slug: 'kavi-app',
  source: 'account-sync',
  mode: 'eas-workflow',
  repoFullName: 'kavi/mobile',
  workflowFile: '.eas/workflows/deploy.yml',
  workflowRef: 'main',
  repoDefaultBranch: 'main',
  availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
  lastSyncedAt: 123,
  platforms: ['android', 'ios', 'web'],
};

const mockProjectListing = {
  id: 'expo-project-1',
  easProjectId: 'eas-project-1',
  name: 'Kavi',
  fullName: '@kavi/kavi-app',
  owner: 'kavi',
  slug: 'kavi-app',
  accountId: 'expo-account-1',
  accountName: 'Expo Prod',
  source: 'account-sync',
  mode: 'eas-workflow',
  repoFullName: 'kavi/mobile',
  availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
  lastSyncedAt: 123,
  readiness: { launchable: true, reason: 'ready', label: 'Ready' },
};

const mockAccount = {
  id: 'expo-account-1',
  name: 'Expo Prod',
  owner: 'kavi',
  tokenRef: 'expo_account_token_expo-account-1',
  enabled: true,
};

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('mock-id'),
}));

jest.mock('../../src/services/canvas/renderer', () => ({
  processCanvasMessage: jest.fn(),
  getSurface: jest.fn().mockReturnValue(undefined),
  getAllSurfaces: jest.fn().mockReturnValue([]),
  getFocusedCanvasSurfaceId: jest.fn().mockReturnValue(null),
  requestCanvasEval: jest.fn().mockResolvedValue('eval_result'),
  requestCanvasSnapshot: jest.fn().mockResolvedValue('data:image/png;base64,'),
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  spawnSubAgent: jest.fn(),
  launchSubAgent: jest.fn(),
  listActiveSubAgents: jest.fn().mockReturnValue([]),
  getSubAgent: jest.fn(),
  getSubAgentsByParent: jest.fn().mockReturnValue([]),
}));

jest.mock('../../src/services/memory/embeddings', () => ({
  hybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/agents/commandPollBackoff', () => ({
  recordCommandPoll: jest.fn(),
  resetCommandPollCount: jest.fn(),
  pruneStaleCommandPolls: jest.fn(),
}));

jest.mock('../../src/services/voice/voice', () => ({
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  transcribeAudio: jest.fn(),
  speakText: jest.fn(),
}));

jest.mock('../../src/services/memory/store', () => ({
  searchMemory: jest.fn().mockReturnValue([]),
}));

jest.mock('../../src/services/agents/personas', () => ({
  BUILT_IN_PERSONAS: [],
}));

jest.mock('../../src/services/agents/registry', () => ({
  getAvailablePersonasForConfig: jest.fn().mockReturnValue([]),
  getAvailablePersonas: jest.fn().mockReturnValue([]),
  getPersona: jest.fn(),
  isBuiltInPersona: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/agents/store', () => ({
  usePersonaConfigStore: {
    getState: jest.fn().mockReturnValue({ personas: [] }),
  },
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: jest.fn().mockReturnValue({}),
  },
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: jest.fn().mockReturnValue({
      expoAccounts: [mockAccount],
      expoProjects: [mockProject],
      sshTargets: [],
    }),
  },
}));

jest.mock('../../src/engine/tools/definitions', () => ({
  TOOL_DEFINITIONS: [],
}));

jest.mock('../../src/services/expo/eas', () => ({
  createExpoProject: jest.fn(),
  getExpoAutomationSummary: jest.fn().mockReturnValue(mockAutomation),
  getExpoProjectDisplayOwner: jest.fn().mockReturnValue('kavi'),
  getExpoProjectExecutionMode: jest.fn().mockReturnValue('eas-workflow'),
  getExpoProjectReadiness: jest.fn().mockReturnValue({ launchable: true, reason: 'ready' }),
  getExpoProjectReadinessLabel: jest.fn().mockReturnValue('Ready'),
  inspectExpoWorkflowRun: jest.fn(),
  listExpoWorkflowRuns: jest.fn(),
  listExpoProjects: jest.fn(),
  probeExpoProject: jest.fn(),
  resolveExpoProjectForExecutionTask: jest.fn(),
  runExpoGraphqlQuery: jest.fn(),
  resolveExpoAccount: jest.fn().mockReturnValue(mockAccount),
  resolveExpoProject: jest.fn().mockReturnValue(mockProject),
  runExpoProjectAction: jest.fn(),
  waitForExpoWorkflowRun: jest.fn(),
}));

jest.mock('../../src/services/ssh/connector', () => ({
  deleteSshPath: jest.fn(),
  executeSshCommand: jest.fn(),
  listSshDirectory: jest.fn(),
  makeSshDirectory: jest.fn(),
  readSshTextFile: jest.fn(),
  renameSshPath: jest.fn(),
  resolveSshTarget: jest.fn(),
  writeSshTextFile: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
}));

import {
  executeExpoEasBuild,
  executeExpoEasCreateProject,
  executeExpoEasListProjects,
  executeExpoEasProbe,
  executeExpoEasStatus,
  executeExpoEasWorkflowStatus,
} from '../../src/engine/tools/parity-executor';
import * as expoEas from '../../src/services/expo/eas';

describe('Parity Tool Executor Expo wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (expoEas.getExpoAutomationSummary as jest.Mock).mockReturnValue(mockAutomation);
    (expoEas.getExpoProjectDisplayOwner as jest.Mock).mockReturnValue('kavi');
    (expoEas.getExpoProjectExecutionMode as jest.Mock).mockReturnValue('eas-workflow');
    (expoEas.getExpoProjectReadiness as jest.Mock).mockReturnValue({
      launchable: true,
      reason: 'ready',
    });
    (expoEas.getExpoProjectReadinessLabel as jest.Mock).mockReturnValue('Ready');
    (expoEas.resolveExpoAccount as jest.Mock).mockReturnValue(mockAccount);
    (expoEas.resolveExpoProject as jest.Mock).mockReturnValue(mockProject);
    (expoEas.listExpoProjects as jest.Mock).mockResolvedValue([mockProjectListing]);
    (expoEas.resolveExpoProjectForExecutionTask as jest.Mock).mockImplementation(({ projectRef }) => {
      if (
        projectRef === 'expo-project-1' ||
        projectRef === 'eas-project-1' ||
        projectRef === '@kavi/kavi-app'
      ) {
        return Promise.resolve({
          status: 'resolved',
          project: mockProjectListing,
          candidates: [mockProjectListing],
          reason: 'project-ref',
          synced: false,
        });
      }
      return Promise.resolve({
        status: 'not_found',
        candidates: [mockProjectListing],
        reason: 'no-matching-project',
        synced: false,
      });
    });
  });

  it('returns lean project listings without repeated automation metadata', async () => {
    (expoEas.listExpoProjects as jest.Mock).mockResolvedValue([
      {
        id: 'expo-project-1',
        easProjectId: 'eas-project-1',
        name: 'Kavi',
        fullName: '@kavi/kavi-app',
        owner: 'kavi',
        slug: 'kavi-app',
        accountId: 'expo-account-1',
        accountName: 'Expo Prod',
        mode: 'eas-workflow',
        readiness: { launchable: true, reason: 'ready', label: 'Ready' },
      },
    ]);

    const parsed = JSON.parse(await executeExpoEasListProjects({}));

    expect(parsed.summary).toBe('Found 1 Expo project. Default project: expo-project-1.');
    expect(parsed.preferredFlow).toBe('commit-driven-eas-workflow');
    expect(parsed.automation).toBeUndefined();
    expect(parsed.projects[0].automation).toBeUndefined();
    expect(parsed.projects[0]).toEqual(
      expect.objectContaining({
        id: 'expo-project-1',
        fullName: '@kavi/kavi-app',
        mode: 'eas-workflow',
        readiness: { launchable: true, reason: 'ready', label: 'Ready' },
      }),
    );
    expect(parsed.selection).toEqual(
      expect.objectContaining({
        doNotRepeatWithoutRefresh: true,
        defaultProjectId: 'expo-project-1',
        defaultProjectFullName: '@kavi/kavi-app',
        nextSuggestedTool: 'expo_eas_status',
        nextSuggestedArgs: { projectId: 'expo-project-1' },
      }),
    );
    expect(parsed.guidance).toContain('Do not call expo_eas_list_projects again');
  });

  it('adds repo-first automation guidance to Expo status responses', async () => {
    const parsed = JSON.parse(await executeExpoEasStatus({ projectId: 'expo-project-1' }));

    expect(parsed.summary).toBe('@kavi/kavi-app: Ready.');
    expect(parsed.preferredFlow).toBe('commit-driven-eas-workflow');
    expect(parsed.automation).toBeUndefined();
    expect(parsed.guidance).toContain('Push a commit to main');
    expect(parsed.note).toContain('Project is ready for repository-driven EAS Workflows');
    expect(parsed.project).toEqual(
      expect.objectContaining({
        id: 'expo-project-1',
        fullName: '@kavi/kavi-app',
        mode: 'eas-workflow',
        workflowFile: '.eas/workflows/deploy.yml',
      }),
    );
  });

  it('returns a structured correction for invalid Expo project references', async () => {
    const parsed = JSON.parse(await executeExpoEasStatus({ projectId: 'Expo' }));

    expect(parsed.status).toBe('invalid_project_reference');
    expect(parsed.argumentName).toBe('projectId');
    expect(parsed.resourceKind).toBe('expo_project');
    expect(parsed.suppliedProjectId).toBe('Expo');
    expect(parsed.selection).toEqual(
      expect.objectContaining({
        defaultProjectId: 'expo-project-1',
        nextSuggestedArgs: { projectId: 'expo-project-1' },
      }),
    );
    expect(parsed.nextSuggestedTool).toBe('expo_eas_status');
    expect(parsed.nextSuggestedArgs).toEqual({ projectId: 'expo-project-1' });
    expect(parsed.guidance).toContain('nextSuggestedArgs');
  });

  it('returns a structured correction for missing Expo project references', async () => {
    const parsed = JSON.parse(await executeExpoEasWorkflowStatus({} as any));

    expect(expoEas.inspectExpoWorkflowRun).not.toHaveBeenCalled();
    expect(parsed.status).toBe('missing_project_reference');
    expect(parsed.argumentName).toBe('projectId');
    expect(parsed.selection.defaultProjectId).toBe('expo-project-1');
    expect(parsed.nextSuggestedTool).toBe('expo_eas_workflow_status');
    expect(parsed.nextSuggestedArgs).toEqual({ projectId: 'expo-project-1' });
  });

  it('redirects create-project calls to an existing resolved project unless creation is confirmed', async () => {
    const existingProject = {
      id: 'expo-project-1',
      easProjectId: 'eas-project-1',
      name: 'Kavi',
      fullName: '@kavi/kavi-app',
      owner: 'kavi',
      slug: 'kavi-app',
      accountId: 'expo-account-1',
      accountName: 'Expo Prod',
      mode: 'eas-workflow',
      repoFullName: 'kavi/mobile',
      readiness: { launchable: true, reason: 'ready', label: 'Ready' },
    };
    (expoEas.resolveExpoProjectForExecutionTask as jest.Mock).mockResolvedValue({
      status: 'resolved',
      project: existingProject,
      candidates: [existingProject],
      reason: 'single-launchable',
      synced: false,
    });

    const parsed = JSON.parse(await executeExpoEasCreateProject({ name: 'Duplicate App' }));

    expect(expoEas.createExpoProject).not.toHaveBeenCalled();
    expect(parsed.status).toBe('redirected_existing_project');
    expect(parsed.project.id).toBe('expo-project-1');
    expect(parsed.nextSuggestedTool).toBe('expo_eas_status');
  });

  it('returns concise summaries for probe and manual action responses', async () => {
    (expoEas.probeExpoProject as jest.Mock).mockResolvedValue({
      ok: true,
      message: 'Expo workflow ready',
      checkedAt: 123,
      checks: [],
    });
    (expoEas.runExpoProjectAction as jest.Mock).mockResolvedValue({
      mode: 'eas-workflow',
      workflowRun: {
        id: 'run-1',
        url: 'https://expo.dev/accounts/kavi/projects/kavi-app/workflows/run-1',
        status: 'IN_PROGRESS',
      },
      note: 'This was a manual workflow dispatch.',
    });

    const probeParsed = JSON.parse(await executeExpoEasProbe({ projectId: 'expo-project-1' }));
    const buildParsed = JSON.parse(await executeExpoEasBuild({ projectId: 'expo-project-1' }));

    expect(probeParsed.summary).toBe('Expo workflow ready');
    expect(probeParsed.automation).toBeUndefined();
    expect(probeParsed.guidance).toContain('Monitor the automatically triggered run');
    expect(buildParsed.summary).toBe('Build workflow run-1: IN_PROGRESS.');
    expect(buildParsed.automation).toBeUndefined();
    expect(buildParsed.preferredFlow).toBe('commit-driven-eas-workflow');
    expect(buildParsed.note).toContain('manual workflow dispatch');
  });

  it('keeps workflow status payloads failure-focused and trimmed', async () => {
    (expoEas.inspectExpoWorkflowRun as jest.Mock).mockResolvedValue({
      status: 'ok',
      projectId: 'expo-project-1',
      projectName: 'Kavi',
      mode: 'eas-workflow',
      workflowRun: {
        id: 'workflow-run-77',
        url: 'https://expo.dev/accounts/kavi/projects/kavi-app/workflows/workflow-run-77',
        status: 'FAILURE',
        conclusion: 'FAILURE',
        createdAt: '2026-03-31T10:00:00Z',
      },
      jobs: [
        {
          id: 'job-1',
          name: 'Build',
          status: 'FAILURE',
          conclusion: 'FAILURE',
          url: 'https://expo.dev/jobs/1',
          steps: [
            { number: 1, name: 'Install Dependencies', status: 'FAILURE', conclusion: 'failure' },
            { number: 2, name: 'Archive', status: 'COMPLETED', conclusion: 'success' },
          ],
        },
      ],
      failureLogs: [
        {
          source: 'Build / Install Dependencies',
          excerpt: [
            'npm ci',
            'npm WARN deprecated package-x',
            'npm ERR! 404 @kavi/private-package not found',
            'Command failed with exit code 1',
            'Verbose stack trace line 1',
            'Verbose stack trace line 2',
          ].join('\n'),
        },
      ],
      guidance: 'Inspect failure logs first and then fix dependencies before retrying.',
    });

    const parsed = JSON.parse(await executeExpoEasWorkflowStatus({ projectId: 'expo-project-1' }));

    expect(parsed.summary).toContain('Workflow workflow-run-77: FAILURE (FAILURE).');
    expect(parsed.summary).toContain('@kavi/private-package not found');
    expect(parsed.automation).toBeUndefined();
    expect(parsed.failureLogs).toEqual([
      {
        source: 'Build / Install Dependencies',
        excerpt: [
          'npm ERR! 404 @kavi/private-package not found',
          'Command failed with exit code 1',
        ].join('\n'),
      },
    ]);
    expect(parsed.jobs).toEqual([
      {
        id: 'job-1',
        name: 'Build',
        status: 'FAILURE',
        conclusion: 'FAILURE',
        url: 'https://expo.dev/jobs/1',
        steps: [
          { number: 1, name: 'Install Dependencies', status: 'FAILURE', conclusion: 'failure' },
        ],
      },
    ]);
  });
});
