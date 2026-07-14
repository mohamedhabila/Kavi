import {
  executeExpoEasBuild,
  executeExpoEasCreateProject,
  executeExpoEasDeployWeb,
  executeExpoEasGraphql,
  executeExpoEasListProjects,
  executeExpoEasProbe,
  executeExpoEasStatus,
  executeExpoEasSubmit,
  executeExpoEasUpdate,
  executeExpoEasWorkflowRuns,
  executeExpoEasWorkflowStatus,
  executeExpoEasWorkflowWait,
  installBuiltinExecutorWrapperReset,
  mockCreateExpoProject,
  mockListExpoProjects,
} from '../helpers/builtinExecutorWrappersHarness';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('builtin-executor wrapper coverage', () => {
  installBuiltinExecutorWrapperReset();

  it('normalizes Expo list, create, and status payloads with automation guidance', async () => {
    const list = parseCompletedToolOutcome(await executeExpoEasListProjects({ refresh: true }));
    const created = parseCompletedToolOutcome(
      await executeExpoEasCreateProject({ accountId: 'acct-1', name: 'Kavi' }),
    );
    const status = parseCompletedToolOutcome(await executeExpoEasStatus({ projectId: 'expo-1' }));

    expect(list).toEqual(
      expect.objectContaining({
        status: 'ok',
        count: 1,
        preferredFlow: 'commit-driven-eas-workflow',
        selection: expect.objectContaining({ defaultProjectId: 'expo-1' }),
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        status: 'ok',
        project: expect.objectContaining({ id: 'expo-1', name: 'Kavi' }),
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(status).toEqual(
      expect.objectContaining({
        status: 'ok',
        preferredFlow: 'commit-driven-eas-workflow',
        project: expect.objectContaining({ id: 'expo-1', name: 'Kavi' }),
      }),
    );
    expect(mockListExpoProjects).toHaveBeenCalledWith({ accountId: undefined, refresh: true });
    expect(mockCreateExpoProject).toHaveBeenCalledWith({ accountId: 'acct-1', name: 'Kavi' });
  });

  it('normalizes Expo probe, action, workflow, and GraphQL wrapper payloads', async () => {
    const probe = parseCompletedToolOutcome(await executeExpoEasProbe({ projectId: 'expo-1' }));
    const build = parseCompletedToolOutcome(
      await executeExpoEasBuild({ projectId: 'expo-1', platform: 'android' }),
    );
    const update = parseCompletedToolOutcome(
      await executeExpoEasUpdate({ projectId: 'expo-1', branch: 'main' }),
    );
    const submit = parseCompletedToolOutcome(
      await executeExpoEasSubmit({ projectId: 'expo-1', platform: 'ios' }),
    );
    const deploy = parseCompletedToolOutcome(
      await executeExpoEasDeployWeb({ projectId: 'expo-1', alias: 'prod' }),
    );
    const runs = parseCompletedToolOutcome(
      await executeExpoEasWorkflowRuns({ projectId: 'expo-1', limit: 5 }),
    );
    const workflowStatus = parseCompletedToolOutcome(
      await executeExpoEasWorkflowStatus({ projectId: 'expo-1', workflowRunId: 'run-1' }),
    );
    const workflowWait = parseCompletedToolOutcome(
      await executeExpoEasWorkflowWait({
        projectId: 'expo-1',
        workflowRunId: 'run-1',
        timeoutMs: 1000,
      }),
    );
    const graphql = parseCompletedToolOutcome(
      await executeExpoEasGraphql({ query: '{ viewer { id } }', projectId: 'expo-1' }),
    );

    expect(probe).toEqual(
      expect.objectContaining({
        status: 'ok',
        ok: true,
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(build).toEqual(
      expect.objectContaining({
        status: 'ok',
        projectId: 'expo-1',
        jobId: 'job-build',
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(update).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-update' }));
    expect(submit).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-submit' }));
    expect(deploy).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-deploy-web' }));
    expect(runs).toEqual(
      expect.objectContaining({
        status: 'ok',
        runs: [{ id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' }],
      }),
    );
    expect(workflowStatus).toEqual(
      expect.objectContaining({
        status: 'ok',
        workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
      }),
    );
    expect(workflowWait).toEqual(
      expect.objectContaining({
        status: 'ok',
        workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
        waitedMs: 2000,
      }),
    );
    expect(graphql).toEqual(
      expect.objectContaining({
        status: 'ok',
        preferredFlow: 'commit-driven-eas-workflow',
        data: { viewer: { id: 'viewer-1' } },
      }),
    );
  });
});
