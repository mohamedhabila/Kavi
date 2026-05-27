import {
  advanceWorkflowRouteStateFromToolResult,
  buildWorkflowRouteFinalizationHoldGuidance,
  buildWorkflowRouteRuntimeGuidance,
  getMissingRequiredWorkflowToolNames,
  buildInitialWorkflowRouteState,
  replayWorkflowRouteStateFromToolResults,
  resolveWorkflowRouteActivation,
  selectToolNamesForWorkflowRoutePhase,
  selectToolNamesForWorkflowRouteTurn,
  shouldHoldWorkflowRouteFinalization,
  validateWorkflowRouteToolCallAgainstState,
} from '../../src/engine/routes/agentRoutes';
import { inferToolCapabilityDescriptor } from '../../src/engine/tools/capabilityRegistry';

const tools = [
  { name: 'read_file', description: 'Read a workspace file.' },
  { name: 'list_files', description: 'List workspace files.' },
  { name: 'write_file', description: 'Write a local workspace file.' },
  { name: 'wait', description: 'Wait for a short period.' },
  { name: 'skill__github__repos', description: 'List repositories available to the token.' },
  { name: 'skill__github__list_files', description: 'List files in a repository tree.' },
  { name: 'skill__github__issues', description: 'List issues for a repository.' },
  { name: 'skill__github__commit_files', description: 'Commit workspace files to a repository.' },
  { name: 'skill__github__create_issue', description: 'Create a GitHub issue.' },
  { name: 'skill__github__workflow_runs', description: 'List GitHub Actions workflow runs.' },
  { name: 'skill__github__checks_status', description: 'Inspect GitHub Checks status.' },
  { name: 'expo_eas_list_projects', description: 'List linked Expo EAS projects.' },
  { name: 'expo_eas_status', description: 'Inspect linked Expo EAS project status.' },
  { name: 'expo_eas_workflow_runs', description: 'List Expo workflow runs.' },
  { name: 'expo_eas_workflow_status', description: 'Inspect an Expo workflow run.' },
  { name: 'expo_eas_workflow_wait', description: 'Wait for an external workflow run.' },
  { name: 'browser_launch', description: 'Launch a browser session.' },
  { name: 'sessions_spawn', description: 'Start delegated worker execution.' },
  { name: 'sessions_wait', description: 'Wait for delegated worker output.' },
  { name: 'sessions_yield', description: 'Yield while delegated workers continue.' },
];

function workflowRequirementKey(requirement: {
  category?: string;
  capability?: string;
  resourceKind?: string;
  evidenceKind?: string;
  workflowStage?: string;
}): string {
  return JSON.stringify({
    category: requirement.category,
    capability: requirement.capability,
    resourceKind: requirement.resourceKind,
    evidenceKind: requirement.evidenceKind,
    workflowStage: requirement.workflowStage,
  });
}

describe('capability workflow routing', () => {
  it('describes tool adapters with generic workflow stages', () => {
    const descriptor = inferToolCapabilityDescriptor(
      tools.find((tool) => tool.name === 'skill__github__commit_files')!,
    );

    expect(descriptor.category).toBe('github');
    expect(descriptor.capabilities).toEqual(expect.arrayContaining(['commit', 'push']));
    expect(descriptor.sideEffects).toContain('remote_mutation');
    expect(descriptor.workflowStages).toEqual(
      expect.arrayContaining(['persist_artifact', 'mutate_remote_state', 'verify_evidence']),
    );
    expect(JSON.stringify(descriptor)).not.toContain('repo-driven-expo-deploy');
  });

  it('activates a generic capability workflow from planner contracts', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'wait', 'verify']),
      plannedToolNames: new Set(['write_file', 'skill__github__commit_files', 'expo_eas_workflow_wait']),
      tools,
    });

    expect(activation?.routeId).toBe('capability-workflow');
    expect(activation?.requiredToolNames).toEqual(
      expect.arrayContaining(['write_file', 'skill__github__commit_files', 'expo_eas_workflow_wait']),
    );
    expect(activation?.phases.map((phase) => phase.id)).toEqual(
      expect.arrayContaining([
        'prepare_artifact',
        'persist_artifact',
        'mutate_remote_state',
        'await_external_execution',
        'verify_evidence',
      ]),
    );
    expect(activation?.guidance).toContain('capability graph');
    expect(activation?.guidance).not.toContain('repo-driven Expo');
  });

  it('derives execution lifecycle requirements from required tool families without choosing unrelated mutators', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(),
      plannedToolNames: new Set(['skill__github__repos']),
      tools,
    });

    expect(activation?.requiredToolNames).toEqual(
      expect.arrayContaining([
        'write_file',
        'skill__github__repos',
        'skill__github__list_files',
        'skill__github__commit_files',
        'expo_eas_list_projects',
        'expo_eas_workflow_runs',
      ]),
    );
    expect(activation?.requiredToolNames).not.toContain('skill__github__workflow_runs');
    expect(activation?.requiredToolNames).not.toContain('skill__github__create_issue');
    expect(activation?.requiredToolNames).not.toContain('wait');
    expect(activation?.phases.map((phase) => phase.id)).toEqual(
      expect.arrayContaining([
        'discover_resource',
        'inspect_resource',
        'prepare_artifact',
        'persist_artifact',
        'mutate_remote_state',
        'monitor_external_execution',
        'verify_evidence',
      ]),
    );
    expect(activation?.requiredWorkflowRequirementKeys.length).toBeGreaterThan(0);
    expect(Object.values(activation?.workflowRequirementLabelsByKey ?? {})).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Persist artifacts'),
        expect.stringContaining('Inspect current state'),
        expect.stringContaining('Apply remote side effects'),
        expect.stringContaining('Monitor external execution'),
        expect.stringContaining('Verify evidence'),
      ]),
    );
  });

  it('keeps passive external monitors scoped to the selected execution substrate in mixed workflows', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const monitorPhase = activation!.phases.find(
      (phase) => phase.id === 'monitor_external_execution',
    );
    const monitorRequirements = monitorPhase?.requiredCapabilities ?? [];

    expect(activation!.requiredToolNames).toEqual(
      expect.arrayContaining([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
      ]),
    );
    expect(activation!.requiredToolNames).not.toContain('skill__github__workflow_runs');
    expect(monitorRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'expo',
          evidenceKind: 'eas_workflow_triggered',
          workflowStage: 'monitor_external_execution',
        }),
      ]),
    );
    expect(monitorRequirements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'github',
          evidenceKind: 'github_workflow',
        }),
      ]),
    );

    const state = replayWorkflowRouteStateFromToolResults(
      activation!,
      tools,
      [
        {
          toolName: 'skill__github__repos',
          result: JSON.stringify({ status: 'ok', repositories: [{ fullName: 'owner/repo' }] }),
          status: 'completed',
          timestamp: 1000.25,
        },
        {
          toolName: 'skill__github__branches',
          result: JSON.stringify({ status: 'ok', branches: [{ name: 'main' }] }),
          status: 'completed',
          timestamp: 1000.5,
        },
        {
          toolName: 'expo_eas_list_projects',
          result: JSON.stringify({ status: 'ok', projects: [{ id: 'project-1' }] }),
          status: 'completed',
          timestamp: 1000.75,
        },
        {
          toolName: 'expo_eas_status',
          result: JSON.stringify({ status: 'ok', projectId: 'project-1' }),
          status: 'completed',
          timestamp: 1000.9,
        },
        {
          toolName: 'read_file',
          result: JSON.stringify({ status: 'ok', path: 'App.js', content: '' }),
          status: 'completed',
          timestamp: 1000.95,
        },
        {
          toolName: 'write_file',
          result: JSON.stringify({ status: 'ok', changedFiles: ['App.js'] }),
          status: 'completed',
          timestamp: 1001,
        },
        {
          toolName: 'skill__github__commit_files',
          result: JSON.stringify({
            status: 'success',
            commitSha: 'abc123',
            pushed: true,
            changedFiles: ['App.js'],
          }),
          status: 'completed',
          timestamp: 1002,
        },
      ],
      { timestamp: 1000 },
    );

    expect(selectToolNamesForWorkflowRoutePhase(activation!, state, tools)).toContain(
      'expo_eas_workflow_runs',
    );
    expect(selectToolNamesForWorkflowRoutePhase(activation!, state, tools)).not.toContain(
      'skill__github__workflow_runs',
    );
  });

  it('does not trust an unrelated planned passive monitor from a mutating family in mixed workflows', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'skill__github__workflow_runs',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const monitorRequirements =
      activation!.phases.find((phase) => phase.id === 'monitor_external_execution')
        ?.requiredCapabilities ?? [];

    expect(activation!.requiredToolNames).toEqual(
      expect.arrayContaining([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
      ]),
    );
    expect(activation!.requiredToolNames).not.toContain('skill__github__workflow_runs');
    expect(monitorRequirements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'github',
          workflowStage: 'monitor_external_execution',
        }),
      ]),
    );
  });

  it('uses planned tool categories when disambiguating mixed passive monitors', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github']),
      requiredCapabilities: new Set(['commit', 'push', 'monitor', 'verify']),
      plannedToolNames: new Set([
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'skill__github__workflow_runs',
        'skill__github__checks_status',
        'browser_launch',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const monitorRequirements =
      activation!.phases.find((phase) => phase.id === 'monitor_external_execution')
        ?.requiredCapabilities ?? [];

    expect(activation!.requiredToolNames).toContain('expo_eas_workflow_runs');
    expect(activation!.requiredToolNames).not.toContain('skill__github__workflow_runs');
    expect(activation!.requiredToolNames).not.toContain('skill__github__checks_status');
    expect(activation!.requiredToolNames).not.toContain('browser_launch');
    expect(monitorRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'expo',
          workflowStage: 'monitor_external_execution',
        }),
      ]),
    );
    expect(monitorRequirements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'github',
          workflowStage: 'monitor_external_execution',
        }),
      ]),
    );
  });

  it('still allows GitHub Actions monitoring when GitHub is the selected execution substrate', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github']),
      requiredCapabilities: new Set(['commit', 'push', 'monitor', 'verify']),
      plannedToolNames: new Set(['skill__github__commit_files']),
      tools,
    });

    expect(activation?.requiredToolNames).toEqual(
      expect.arrayContaining(['skill__github__commit_files', 'skill__github__workflow_runs']),
    );
    expect(
      activation?.phases
        .flatMap((phase) => phase.requiredCapabilities)
        .some(
          (requirement) =>
            requirement.category === 'github' &&
            requirement.evidenceKind === 'github_workflow' &&
            requirement.workflowStage === 'monitor_external_execution',
        ),
    ).toBe(true);
  });

  it('does not make passive conversation-scoped monitors workflow requirements without a planned producer', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github', 'sessions']),
      requiredCapabilities: new Set(),
      plannedToolNames: new Set(['skill__github__commit_files']),
      tools,
    });

    expect(activation?.requiredToolNames).toEqual(
      expect.arrayContaining(['skill__github__commit_files']),
    );
    expect(activation?.requiredToolNames).not.toContain('sessions_wait');
    expect(activation?.requiredToolNames).not.toContain('sessions_yield');
    expect(
      activation?.phases
        .flatMap((phase) => phase.requiredCapabilities)
        .some((requirement) => requirement.category === 'sessions'),
    ).toBe(false);
  });

  it('adds passive conversation-scoped monitors after a matching producer is planned', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['sessions']),
      requiredCapabilities: new Set(['wait', 'verify']),
      plannedToolNames: new Set(['sessions_spawn']),
      tools,
    });

    expect(activation?.requiredToolNames).toEqual(
      expect.arrayContaining(['sessions_spawn', 'sessions_wait']),
    );
    expect(
      activation?.phases
        .flatMap((phase) => phase.requiredCapabilities)
        .some(
          (requirement) =>
            requirement.category === 'sessions' &&
            requirement.workflowStage === 'await_external_execution',
        ),
    ).toBe(true);
  });

  it('does not let one discovery result complete all resource discovery requirements', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(),
      plannedToolNames: new Set(['skill__github__repos']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const advanced = advanceWorkflowRouteStateFromToolResult(
      state,
      {
        toolName: 'skill__github__repos',
        result: JSON.stringify([{ full_name: 'mohamedhabila/Expo' }]),
        status: 'completed',
        timestamp: 2000,
      },
      tools,
      activation,
    );

    expect(advanced?.status).toBe('active');
    expect(advanced?.currentPhaseId).toBe('discover_resource');
    expect(advanced?.phases.find((phase) => phase.id === 'discover_resource')?.status).toBe(
      'active',
    );
    expect(shouldHoldWorkflowRouteFinalization(advanced)).toBe(true);
  });

  it('requires repository content inspection before repository mutation can finalize', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github']),
      requiredCapabilities: new Set(['read']),
      plannedToolNames: new Set(['skill__github__repos']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const inspectState = {
      ...state,
      currentPhaseId: 'inspect_resource',
      phases: state.phases.map((phase) =>
        phase.id === 'discover_resource'
          ? { ...phase, status: 'completed' as const }
          : phase.id === 'inspect_resource'
            ? { ...phase, status: 'active' as const }
            : phase,
      ),
    };

    const phaseTools = selectToolNamesForWorkflowRoutePhase(
      activation,
      inspectState,
      tools,
    );

    expect(phaseTools).toContain('skill__github__list_files');
    expect(phaseTools).not.toContain('skill__github__repos');
    expect(phaseTools).not.toContain('skill__github__issues');
  });

  it('does not let mutation evidence satisfy unresolved inspection requirements', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github']),
      requiredCapabilities: new Set(['commit', 'push']),
      plannedToolNames: new Set(['skill__github__commit_files']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const advanced = advanceWorkflowRouteStateFromToolResult(
      state,
      {
        toolName: 'skill__github__commit_files',
        result: JSON.stringify({ status: 'success', commitSha: 'abc123', pushed: true }),
        status: 'completed',
        timestamp: 2000,
      },
      tools,
      activation,
    );

    expect(advanced?.status).toBe('active');
    expect(advanced?.currentPhaseId).toBe('discover_resource');
    expect(getMissingRequiredWorkflowToolNames(advanced)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('skill__github__repos'),
        expect.stringContaining('skill__github__list_files'),
      ]),
    );
    expect(shouldHoldWorkflowRouteFinalization(advanced, [
      'skill__github__repos',
      'skill__github__list_files',
      'skill__github__commit_files',
    ])).toBe(true);
  });

  it('does not treat the generic wait timer as workflow evidence', () => {
    const descriptor = inferToolCapabilityDescriptor(
      tools.find((tool) => tool.name === 'wait')!,
    );

    expect(descriptor.workflowStages).toEqual([]);
    expect(descriptor.providesEvidence).toEqual([]);
  });

  it('does not activate workflow state for research-only routing', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'research',
      requiredToolCategories: new Set(['web_research']),
      requiredCapabilities: new Set(['read']),
      plannedToolNames: new Set(['web_search']),
      tools,
    });

    expect(activation).toBeUndefined();
  });

  it('advances generic stages from tool contract evidence', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github']),
      requiredCapabilities: new Set(['commit', 'push']),
      plannedToolNames: new Set(['skill__github__commit_files']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const advanced = advanceWorkflowRouteStateFromToolResult(
      state,
      {
        toolName: 'skill__github__commit_files',
        result: JSON.stringify({ status: 'ok', commitSha: 'abc123' }),
        status: 'completed',
        timestamp: 2000,
      },
      tools,
    );

    expect(advanced?.phases.find((phase) => phase.id === 'mutate_remote_state')?.status).toBe(
      'completed',
    );
    expect(advanced?.facts?.lastAdvancedByTool).toBe('skill__github__commit_files');
  });

  it('keeps prerequisite discovery tools active before dependent resource tools', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['expo']),
      requiredCapabilities: new Set(['verify']),
      plannedToolNames: new Set(['expo_eas_status']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    expect(state.currentPhaseId).toBe('discover_resource');
    expect(selectToolNamesForWorkflowRoutePhase(activation, state, tools)).toEqual([
      'expo_eas_list_projects',
    ]);
  });

  it('keeps completed mutation tools out of later evidence-gathering turns', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(),
      plannedToolNames: new Set(['write_file', 'skill__github__commit_files', 'expo_eas_workflow_wait']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    const turnTools = selectToolNamesForWorkflowRouteTurn(
      activation,
      monitorState,
      tools,
      [
        'write_file',
        'skill__github__repos',
        'skill__github__commit_files',
        'expo_eas_list_projects',
        'expo_eas_status',
      ],
    );

    expect(turnTools).toEqual(expect.arrayContaining(['expo_eas_workflow_runs']));
    expect(turnTools).not.toContain('skill__github__commit_files');
    expect(turnTools).not.toContain('write_file');
  });

  it('does not advance external monitoring from a stale workflow run created before the current mutation', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        latestExternalProducerId: 'abc123',
        latestExternalProducerAt: 10_000,
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    const advanced = advanceWorkflowRouteStateFromToolResult(
      monitorState,
      {
        toolName: 'expo_eas_workflow_runs',
        result: JSON.stringify({
          status: 'ok',
          runs: [{ id: 'old-run', status: 'FAILED', createdAt: '1970-01-01T00:00:00.000Z' }],
        }),
        status: 'completed',
        timestamp: 11_000,
      },
      tools,
      activation,
    );

    expect(advanced?.currentPhaseId).toBe('monitor_external_execution');
    expect(advanced?.facts?.currentExternalWorkflowRunId).toBeUndefined();
    expect(advanced?.facts?.uncorrelatedExternalMonitorCount).toBe(1);
    expect(advanced?.facts?.lastAdvancedByTool).toBeUndefined();
    expect(advanced?.facts?.lastObservedByTool).toBe('expo_eas_workflow_runs');
    expect(getMissingRequiredWorkflowToolNames(advanced)).toEqual(
      expect.arrayContaining([expect.stringContaining('expo_eas_workflow_runs')]),
    );
    expect(selectToolNamesForWorkflowRoutePhase(activation, advanced, tools)).toContain(
      'expo_eas_workflow_runs',
    );
    expect(selectToolNamesForWorkflowRoutePhase(activation, advanced, tools)).not.toContain(
      'expo_eas_workflow_wait',
    );
    expect(buildWorkflowRouteRuntimeGuidance(activation, advanced, tools)).toContain(
      'stale or unrelated external runs',
    );
  });

  it('turns guided stale external monitor evidence into trigger diagnostics instead of another poll', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        latestExternalProducerId: 'abc123',
        latestExternalProducerAt: 10_000,
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    const advanced = advanceWorkflowRouteStateFromToolResult(
      monitorState,
      {
        toolName: 'expo_eas_workflow_runs',
        result: JSON.stringify({
          status: 'ok',
          runs: [{ id: 'old-run', status: 'FAILED', createdAt: '1970-01-01T00:00:00.000Z' }],
          note: 'Use this after pushing a commit to the branch that owns the workflow file.',
          guidance: 'Inspect trigger prerequisites before waiting on a stale run.',
          trigger: {
            source: 'remote_mutation',
            expectedAfter: 'push',
            branch: 'main',
            configPaths: ['.eas/workflows/deploy.yml'],
          },
        }),
        status: 'completed',
        timestamp: 11_000,
      },
      tools,
      activation,
    );

    expect(advanced?.status).toBe('active');
    expect(advanced?.facts?.externalRunCorrelationDiagnosticRequired).toBe(true);
    expect(selectToolNamesForWorkflowRoutePhase(activation, advanced, tools)).toEqual(
      expect.arrayContaining(['skill__github__list_files', 'expo_eas_status']),
    );
    expect(selectToolNamesForWorkflowRoutePhase(activation, advanced, tools)).not.toContain(
      'expo_eas_workflow_runs',
    );
    expect(buildWorkflowRouteRuntimeGuidance(activation, advanced, tools)).toContain(
      'inspect the trigger prerequisites',
    );
    expect(buildWorkflowRouteRuntimeGuidance(activation, advanced, tools)).toContain(
      '.eas/workflows/deploy.yml',
    );
  });

  it('does not treat prose-only external monitor guidance as a control signal', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        latestExternalProducerId: 'abc123',
        latestExternalProducerAt: 10_000,
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    const advanced = advanceWorkflowRouteStateFromToolResult(
      monitorState,
      {
        toolName: 'expo_eas_workflow_runs',
        result: JSON.stringify({
          status: 'ok',
          runs: [{ id: 'old-run', status: 'FAILED', createdAt: '1970-01-01T00:00:00.000Z' }],
          note: 'A status tool can inspect a known run id.',
          guidance: 'Wait only after a producer returns a run handle.',
        }),
        status: 'completed',
        timestamp: 11_000,
      },
      tools,
      activation,
    );

    expect(advanced?.status).toBe('active');
    expect(advanced?.facts?.externalRunCorrelationDiagnosticRequired).toBeUndefined();
    expect(buildWorkflowRouteRuntimeGuidance(activation, advanced, tools)).not.toContain(
      'inspect the trigger prerequisites',
    );
  });

  it('uses typed trigger branch as a correlation constraint for corrective mutations', () => {
    const toolsWithBranchMutation = [
      ...tools,
      { name: 'skill__github__create_branch', description: 'Create a GitHub repository branch.' },
    ];
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__create_branch',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools: toolsWithBranchMutation,
    });
    expect(activation).toBeDefined();
    expect(activation!.requiredToolNames).toContain('skill__github__create_branch');

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        latestExternalProducerId: 'abc123',
        latestExternalProducerAt: 10_000,
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    const advanced = advanceWorkflowRouteStateFromToolResult(
      monitorState,
      {
        toolName: 'expo_eas_workflow_runs',
        result: JSON.stringify({
          status: 'ok',
          runs: [{ id: 'old-run', status: 'FAILED', createdAt: '1970-01-01T00:00:00.000Z' }],
          trigger: {
            source: 'remote_mutation',
            expectedAfter: 'push',
            branch: 'refs/heads/master',
            configPaths: ['.eas/workflows/deploy.yml'],
          },
        }),
        status: 'completed',
        timestamp: 11_000,
      },
      toolsWithBranchMutation,
      activation,
    );
    expect(advanced?.facts?.externalRunCorrelationTriggerBranch).toBe('master');
    expect(advanced?.facts?.externalRunCorrelationTriggerExpectedAfter).toBe('push');

    const afterDiagnosticInspection = {
      ...advanced!,
      facts: {
        ...(advanced!.facts ?? {}),
        externalRunCorrelationDiagnosticInspectionCount: 1,
      },
    };
    const correctiveTools = selectToolNamesForWorkflowRoutePhase(
      activation!,
      afterDiagnosticInspection,
      toolsWithBranchMutation,
    );
    expect(correctiveTools).toContain('skill__github__commit_files');
    expect(correctiveTools).not.toContain('skill__github__create_branch');

    expect(
      validateWorkflowRouteToolCallAgainstState(
        advanced,
        'skill__github__commit_files',
        JSON.stringify({ repo: 'owner/repo', branch: 'feature/web-app-v2', changes: [] }),
        toolsWithBranchMutation,
      ),
    ).toContain('expects the next remote mutation on branch master');
    expect(
      validateWorkflowRouteToolCallAgainstState(
        advanced,
        'skill__github__commit_files',
        JSON.stringify({ repo: 'owner/repo', branch: 'refs/heads/master', changes: [] }),
        toolsWithBranchMutation,
      ),
    ).toBeUndefined();
  });

  it('blocks repeated uncorrelated external monitor observations instead of polling forever', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    let monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        latestExternalProducerId: 'abc123',
        latestExternalProducerAt: 10_000,
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    for (let index = 0; index < 3; index += 1) {
      monitorState = advanceWorkflowRouteStateFromToolResult(
        monitorState,
        {
          toolName: 'expo_eas_workflow_runs',
          result: JSON.stringify({
            status: 'ok',
            runs: [
              {
                id: `old-run-${index}`,
                status: 'FAILED',
                createdAt: '1970-01-01T00:00:00.000Z',
              },
            ],
          }),
          status: 'completed',
          timestamp: 11_000 + index,
        },
        tools,
        activation,
      )!;
    }

    expect(monitorState.status).toBe('blocked');
    expect(monitorState.facts?.uncorrelatedExternalMonitorCount).toBe(3);
    expect(monitorState.facts?.blockedWorkflowToolNames).toEqual(['expo_eas_workflow_runs']);
    expect(monitorState.blockers?.[0]).toContain('could not be correlated');
    expect(selectToolNamesForWorkflowRoutePhase(activation, monitorState, tools)).toEqual([]);
  });

  it('blocks repeated identical uncorrelated monitor evidence as non-progress', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    let monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        latestExternalProducerId: 'abc123',
        latestExternalProducerAt: 10_000,
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };
    const staleResult = JSON.stringify({
      status: 'ok',
      runs: [
        {
          id: 'old-run',
          status: 'FAILED',
          createdAt: '1970-01-01T00:00:00.000Z',
        },
      ],
    });

    for (let index = 0; index < 2; index += 1) {
      monitorState = advanceWorkflowRouteStateFromToolResult(
        monitorState,
        {
          toolName: 'expo_eas_workflow_runs',
          result: staleResult,
          status: 'completed',
          timestamp: 11_000 + index,
        },
        tools,
        activation,
      )!;
    }

    expect(monitorState.status).toBe('blocked');
    expect(monitorState.facts?.uncorrelatedExternalMonitorCount).toBe(2);
    expect(monitorState.facts?.repeatedUncorrelatedExternalMonitorCount).toBe(2);
    expect(monitorState.blockers?.[0]).toContain('same uncorrelated monitor evidence repeated');
    expect(selectToolNamesForWorkflowRoutePhase(activation, monitorState, tools)).toEqual([]);
  });

  it('does not select passive wait tools until an external run is correlated', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        latestExternalProducerId: 'abc123',
        latestExternalProducerAt: 10_000,
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            [
              'discover_resource',
              'inspect_resource',
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
            ].includes(phase.id),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    expect(selectToolNamesForWorkflowRoutePhase(activation, monitorState, tools)).toContain(
      'expo_eas_workflow_runs',
    );
    expect(selectToolNamesForWorkflowRoutePhase(activation, monitorState, tools)).not.toContain(
      'expo_eas_workflow_wait',
    );

    const correlatedState = advanceWorkflowRouteStateFromToolResult(
      monitorState,
      {
        toolName: 'expo_eas_workflow_runs',
        result: JSON.stringify({
          status: 'ok',
          runs: [
            {
              id: 'run-1',
              status: 'IN_PROGRESS',
              createdAt: new Date(12_000).toISOString(),
            },
          ],
        }),
        status: 'completed',
        timestamp: 13_000,
      },
      tools,
      activation,
    );

    expect(correlatedState?.facts?.currentExternalWorkflowRunId).toBe('run-1');

    const awaitState = {
      ...correlatedState!,
      currentPhaseId: 'await_external_execution',
      phases: correlatedState!.phases.map((phase) =>
        phase.id === 'await_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
    };

    expect(selectToolNamesForWorkflowRoutePhase(activation, awaitState, tools)).toContain(
      'expo_eas_workflow_wait',
    );
  });

  it('advances workflow monitoring only when the run is correlated to the current mutation', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = replayWorkflowRouteStateFromToolResults(
      activation!,
      tools,
      [
        {
          toolName: 'skill__github__repos',
          result: JSON.stringify({ status: 'ok', repositories: [{ name: 'Expo' }] }),
          status: 'completed',
          timestamp: 1001,
        },
        {
          toolName: 'skill__github__list_files',
          result: JSON.stringify({ status: 'ok', files: [] }),
          status: 'completed',
          timestamp: 1002,
        },
        {
          toolName: 'expo_eas_list_projects',
          result: JSON.stringify({ status: 'ok', projects: [{ id: 'project-1' }] }),
          status: 'completed',
          timestamp: 1003,
        },
        {
          toolName: 'expo_eas_status',
          result: JSON.stringify({ status: 'ok', projectId: 'project-1' }),
          status: 'completed',
          timestamp: 1004,
        },
        {
          toolName: 'read_file',
          result: JSON.stringify({ status: 'ok', path: 'package.json', content: '{}' }),
          status: 'completed',
          timestamp: 1004.5,
        },
        {
          toolName: 'write_file',
          result: JSON.stringify({ status: 'ok', path: 'package.json' }),
          status: 'completed',
          timestamp: 1005,
        },
        {
          toolName: 'skill__github__commit_files',
          result: JSON.stringify({
            status: 'success',
            commitSha: 'abc123',
            pushed: true,
            changedFiles: ['package.json', 'App.js'],
          }),
          status: 'completed',
          timestamp: 2000,
        },
        {
          toolName: 'expo_eas_workflow_runs',
          result: JSON.stringify({
            status: 'ok',
            runs: [
              {
                id: 'run-1',
                status: 'IN_PROGRESS',
                createdAt: new Date(2500).toISOString(),
              },
            ],
          }),
          status: 'completed',
          timestamp: 3000,
        },
        {
          toolName: 'expo_eas_workflow_wait',
          result: JSON.stringify({
            status: 'ok',
            workflowRun: {
              id: 'run-1',
              status: 'COMPLETED',
              conclusion: 'success',
              createdAt: new Date(2500).toISOString(),
            },
          }),
          status: 'completed',
          timestamp: 4000,
        },
      ],
      { timestamp: 1000 },
    );

    expect(state.facts?.currentExternalWorkflowRunId).toBe('run-1');
    expect(getMissingRequiredWorkflowToolNames(state, [
      'skill__github__repos',
      'skill__github__list_files',
      'expo_eas_list_projects',
      'expo_eas_status',
      'write_file',
      'skill__github__commit_files',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_wait',
    ])).toEqual([]);
    expect(shouldHoldWorkflowRouteFinalization(state, [
      'skill__github__repos',
      'skill__github__list_files',
      'expo_eas_list_projects',
      'expo_eas_status',
      'write_file',
      'skill__github__commit_files',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_wait',
    ])).toBe(false);
  });

  it('does not treat a failed terminal external run as final verification evidence', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = replayWorkflowRouteStateFromToolResults(
      activation!,
      tools,
      [
        {
          toolName: 'skill__github__repos',
          result: JSON.stringify({ status: 'ok', repositories: [{ name: 'Expo' }] }),
          status: 'completed',
          timestamp: 1001,
        },
        {
          toolName: 'skill__github__branches',
          result: JSON.stringify({ status: 'ok', branches: [{ name: 'main' }] }),
          status: 'completed',
          timestamp: 1001.25,
        },
        {
          toolName: 'skill__github__list_files',
          result: JSON.stringify({ status: 'ok', files: ['App.js', 'package.json'] }),
          status: 'completed',
          timestamp: 1001.5,
        },
        {
          toolName: 'expo_eas_list_projects',
          result: JSON.stringify({ status: 'ok', projects: [{ id: 'project-1' }] }),
          status: 'completed',
          timestamp: 1002,
        },
        {
          toolName: 'expo_eas_status',
          result: JSON.stringify({
            status: 'ok',
            project: {
              id: 'project-1',
              workflowFile: '.eas/workflows/deploy.yml',
              availableWorkflowFiles: ['.eas/workflows/deploy.yml'],
            },
          }),
          status: 'completed',
          timestamp: 1003,
        },
        {
          toolName: 'list_files',
          result: JSON.stringify({ status: 'ok', files: ['App.js', 'package.json'] }),
          status: 'completed',
          timestamp: 1003.5,
        },
        {
          toolName: 'write_file',
          result: JSON.stringify({ status: 'ok', path: 'App.js' }),
          status: 'completed',
          timestamp: 1004,
        },
        {
          toolName: 'skill__github__commit_files',
          result: JSON.stringify({
            status: 'success',
            commitSha: 'abc123',
            changedFiles: ['App.js', 'package.json'],
          }),
          status: 'completed',
          timestamp: 2000,
        },
        {
          toolName: 'expo_eas_workflow_runs',
          result: JSON.stringify({
            status: 'ok',
            runs: [
              {
                id: 'run-1',
                status: 'IN_PROGRESS',
                createdAt: new Date(2500).toISOString(),
              },
            ],
          }),
          status: 'completed',
          timestamp: 3000,
        },
        {
          toolName: 'expo_eas_workflow_wait',
          result: JSON.stringify({
            status: 'ok',
            workflowRun: {
              id: 'run-1',
              status: 'FAILURE',
              createdAt: new Date(2500).toISOString(),
            },
            logs: 'Build failed while bundling the app artifact.',
          }),
          status: 'completed',
          timestamp: 4000,
        },
      ],
      { timestamp: 1000 },
    );

    expect(state.status).toBe('active');
    expect(state.currentPhaseId).toBe('verify_evidence');
    expect(state.facts?.lastExternalRunFailureDetail).toContain('Build failed');
    expect(shouldHoldWorkflowRouteFinalization(state, [
      'skill__github__repos',
      'expo_eas_list_projects',
      'expo_eas_status',
      'write_file',
      'skill__github__commit_files',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_wait',
    ])).toBe(true);

    const recoveryTools = selectToolNamesForWorkflowRoutePhase(activation, state, tools);
    expect(recoveryTools).toEqual(expect.arrayContaining(['write_file', 'skill__github__commit_files']));
    expect(buildWorkflowRouteRuntimeGuidance(activation, state, tools)).toContain(
      'failed external execution',
    );
  });

  it('protects discovered external workflow configuration from implicit remote mutation', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = replayWorkflowRouteStateFromToolResults(
      activation!,
      tools,
      [
        {
          toolName: 'expo_eas_status',
          result: JSON.stringify({
            status: 'ok',
            project: {
              id: 'project-1',
              fullName: '@owner/mobile-app',
              repository: 'owner/repo',
              lastRunCreatedAt: '2026-05-26T17:34:56.377Z',
              readiness: { launchable: true },
              workflowFile: 'deploy.yml',
              availableWorkflowFiles: ['deploy.yml', 'build.yml'],
            },
          }),
          status: 'completed',
          timestamp: 1000,
        },
      ],
      { timestamp: 1000 },
    );

    expect(state.facts?.observedExternalWorkflowConfigPaths).toEqual(
      expect.arrayContaining(['deploy.yml', 'build.yml']),
    );
    expect(state.facts?.observedExternalWorkflowConfigPaths).not.toEqual(
      expect.arrayContaining(['@owner/mobile-app', 'owner/repo', '2026-05-26T17:34:56.377Z']),
    );
    expect(
      validateWorkflowRouteToolCallAgainstState(
        state,
        'skill__github__commit_files',
        JSON.stringify({
          repo: 'owner/repo',
          branch: 'main',
          changes: [{ path: '.github/workflows/deploy.yml', content: 'name: deploy' }],
        }),
        tools,
      ),
    ).toContain('previously discovered external workflow configuration');
    expect(
      validateWorkflowRouteToolCallAgainstState(
        state,
        'skill__github__commit_files',
        JSON.stringify({
          repo: 'owner/repo',
          branch: 'main',
          changes: [{ path: 'App.js', content: 'export default function App() {}' }],
        }),
        tools,
      ),
    ).toBeUndefined();
  });

  it('applies external-run correlation generically to non-Expo monitors', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['sessions']),
      requiredCapabilities: new Set(['write', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set(['sessions_spawn', 'sessions_wait']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = replayWorkflowRouteStateFromToolResults(
      activation!,
      tools,
      [
        {
          toolName: 'sessions_spawn',
          result: JSON.stringify({ status: 'running', sessionId: 'worker-1' }),
          status: 'completed',
          timestamp: 1000,
        },
        {
          toolName: 'sessions_wait',
          result: JSON.stringify({
            status: 'completed',
            run: {
              id: 'worker-1',
              status: 'completed',
              createdAt: new Date(1500).toISOString(),
            },
          }),
          status: 'completed',
          timestamp: 2000,
        },
      ],
      { timestamp: 900 },
    );

    expect(state.facts?.latestExternalProducerId).toBe('worker-1');
    expect(state.facts?.currentExternalWorkflowRunId).toBe('worker-1');
    expect(
      state.phases.find((phase) => phase.id === 'await_external_execution')?.status,
    ).toBe('completed');
  });

  it('allows passive waits after a producer tool starts an external run directly', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['sessions']),
      requiredCapabilities: new Set(['write', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set(['sessions_spawn', 'sessions_wait']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = replayWorkflowRouteStateFromToolResults(
      activation!,
      tools,
      [
        {
          toolName: 'sessions_spawn',
          result: JSON.stringify({ status: 'running', sessionId: 'worker-1' }),
          status: 'completed',
          timestamp: 1000,
        },
      ],
      { timestamp: 900 },
    );

    expect(state.facts?.currentExternalWorkflowRunId).toBe('worker-1');
    expect(selectToolNamesForWorkflowRoutePhase(activation, state, tools)).toContain(
      'sessions_wait',
    );
  });

  it('does not keep conversation-scoped monitors alive before a producer returns a run handle', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['sessions']),
      requiredCapabilities: new Set(['write', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set(['sessions_spawn', 'sessions_wait']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'await_external_execution' || phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) => phase.id === 'start_external_execution')
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    expect(selectToolNamesForWorkflowRoutePhase(activation, monitorState, tools)).toEqual([]);
    expect(buildWorkflowRouteRuntimeGuidance(activation, monitorState, tools)).toContain(
      'Passive conversation-scoped monitors require a known run or session id',
    );
  });

  it('forces artifact bootstrap after missing workspace file reads', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files']),
      requiredCapabilities: new Set(['write']),
      plannedToolNames: new Set(['read_file', 'write_file']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const advanced = advanceWorkflowRouteStateFromToolResult(
      state,
      {
        toolName: 'read_file',
        result: 'Error: file not found: package.json',
        status: 'completed',
        timestamp: 2000,
      },
      tools,
      activation,
    );

    expect(advanced?.facts?.missingWorkspaceArtifactPaths).toEqual(['package.json']);
    expect(selectToolNamesForWorkflowRoutePhase(activation, advanced, tools)).toContain(
      'write_file',
    );
    expect(buildWorkflowRouteRuntimeGuidance(activation, advanced, tools)).toContain(
      'Create the required artifacts now',
    );
  });

  it('blocks workflow advancement on generic access-denied tool failures', () => {
    const githubWorkflowTools = [
      ...tools,
      { name: 'skill__github__workflow_runs', description: 'List external workflow runs.' },
    ];
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github']),
      requiredCapabilities: new Set(['monitor', 'verify']),
      plannedToolNames: new Set(['skill__github__workflow_runs']),
      tools: githubWorkflowTools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) => phase.id !== 'monitor_external_execution' && phase.id !== 'verify_evidence')
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };
    const advanced = advanceWorkflowRouteStateFromToolResult(
      monitorState,
      {
        toolName: 'skill__github__workflow_runs',
        result: 'Error: HTTP 403: access denied by the configured credential.',
        status: 'completed',
        timestamp: 2000,
      },
      githubWorkflowTools,
      activation,
    );

    expect(advanced?.status).toBe('blocked');
    expect(advanced?.blockers?.[0]).toContain('HTTP 403');
  });

  it('suppresses a blocked monitor tool while alternate monitor tools remain available', () => {
    const monitorTools = [
      ...tools,
      { name: 'skill__github__workflow_runs', description: 'List external workflow runs.' },
    ];
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github', 'expo']),
      requiredCapabilities: new Set(['monitor', 'verify']),
      plannedToolNames: new Set(['skill__github__workflow_runs', 'expo_eas_workflow_runs']),
      tools: monitorTools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const monitorState = {
      ...state,
      currentPhaseId: 'monitor_external_execution',
      phases: state.phases.map((phase) =>
        phase.id === 'monitor_external_execution'
          ? { ...phase, status: 'active' as const }
          : phase.id === 'verify_evidence'
            ? { ...phase, status: 'pending' as const }
            : { ...phase, status: 'completed' as const },
      ),
      facts: {
        ...(state.facts ?? {}),
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) => phase.id !== 'monitor_external_execution' && phase.id !== 'verify_evidence')
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };
    const advanced = advanceWorkflowRouteStateFromToolResult(
      monitorState,
      {
        toolName: 'skill__github__workflow_runs',
        result: 'Error: HTTP 403: access denied by the configured credential.',
        status: 'failed',
        timestamp: 2000,
      },
      monitorTools,
      activation,
    );

    expect(advanced?.status).toBe('active');
    expect(advanced?.blockers?.[0]).toContain('HTTP 403');
    expect(advanced?.facts?.blockedWorkflowToolNames).toEqual([
      'skill__github__workflow_runs',
    ]);
    expect(selectToolNamesForWorkflowRoutePhase(activation, advanced, monitorTools)).toContain(
      'expo_eas_workflow_runs',
    );
    expect(selectToolNamesForWorkflowRoutePhase(activation, advanced, monitorTools)).not.toContain(
      'skill__github__workflow_runs',
    );
    expect(buildWorkflowRouteRuntimeGuidance(activation, advanced, monitorTools)).toContain(
      'Blocked workflow tools',
    );
  });

  it('keeps remote mutation evidence separate from unresolved local artifact requirements', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'verify']),
      plannedToolNames: new Set(['write_file', 'skill__github__commit_files']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const mutationState = {
      ...state,
      currentPhaseId: 'mutate_remote_state',
      phases: state.phases.map((phase) =>
        phase.id === 'mutate_remote_state'
          ? { ...phase, status: 'active' as const }
          : ['discover_resource', 'inspect_resource', 'prepare_artifact', 'persist_artifact'].includes(
                phase.id,
              )
            ? { ...phase, status: 'completed' as const }
            : phase,
      ),
      facts: {
        ...(state.facts ?? {}),
        completedWorkflowRequirementKeys: activation!.phases
          .filter((phase) =>
            ['discover_resource', 'inspect_resource', 'prepare_artifact', 'persist_artifact'].includes(
              phase.id,
            ),
          )
          .flatMap((phase) => phase.requiredCapabilities.map(workflowRequirementKey)),
      },
    };

    const advanced = advanceWorkflowRouteStateFromToolResult(
      mutationState,
      {
        toolName: 'skill__github__commit_files',
        result: JSON.stringify({
          status: 'success',
          commitSha: 'abc123',
          pushed: true,
          changedFiles: ['remote-only.txt'],
        }),
        status: 'completed',
        timestamp: 2000,
      },
      tools,
      activation,
    );

    expect(advanced?.facts?.latestExternalProducerId).toBe('abc123');
    expect(advanced?.phases.find((phase) => phase.id === 'prepare_artifact')?.status).toBe(
      'completed',
    );
    expect(getMissingRequiredWorkflowToolNames(advanced)).toEqual(
      expect.arrayContaining([expect.stringContaining('expo_eas_workflow_runs')]),
    );
  });

  it('holds finalization while a workflow route still has incomplete phases', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['github']),
      requiredCapabilities: new Set(['commit', 'push']),
      plannedToolNames: new Set(['skill__github__commit_files']),
      tools,
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);

    expect(shouldHoldWorkflowRouteFinalization(state)).toBe(true);
    expect(buildWorkflowRouteFinalizationHoldGuidance(activation, state, tools)).toContain(
      'Do not hand this draft to final review yet',
    );
  });

  it('holds finalization when required execution tools have not produced evidence', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(),
      plannedToolNames: new Set(['skill__github__repos']),
      tools,
    });
    expect(activation).toBeDefined();
    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const completedState = {
      ...state,
      status: 'completed' as const,
      phases: state.phases.map((phase) => ({ ...phase, status: 'completed' as const })),
    };

    const missing = getMissingRequiredWorkflowToolNames(completedState, [
      'skill__github__repos',
      'expo_eas_list_projects',
      'expo_eas_status',
    ]);

    expect(missing).toEqual(
      expect.arrayContaining(['write_file', 'skill__github__commit_files']),
    );
    expect(shouldHoldWorkflowRouteFinalization(completedState, [
      'skill__github__repos',
      'expo_eas_list_projects',
      'expo_eas_status',
    ])).toBe(true);
  });

  it('replays durable tool evidence instead of requiring every candidate tool name', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files', 'github', 'expo']),
      requiredCapabilities: new Set(['write', 'commit', 'push', 'monitor', 'wait', 'verify']),
      plannedToolNames: new Set([
        'write_file',
        'skill__github__commit_files',
        'expo_eas_workflow_runs',
        'expo_eas_workflow_wait',
      ]),
      tools,
    });
    expect(activation).toBeDefined();

    const state = replayWorkflowRouteStateFromToolResults(
      activation!,
      tools,
      [
        {
          toolName: 'skill__github__repos',
          result: JSON.stringify({ status: 'ok', repositories: [{ name: 'Expo' }] }),
          status: 'completed',
          timestamp: 1001,
        },
        {
          toolName: 'skill__github__list_files',
          result: JSON.stringify({ status: 'ok', files: ['package.json', 'App.tsx'] }),
          status: 'completed',
          timestamp: 1001.5,
        },
        {
          toolName: 'expo_eas_list_projects',
          result: JSON.stringify({ status: 'ok', projects: [{ id: 'project-1' }] }),
          status: 'completed',
          timestamp: 1002,
        },
        {
          toolName: 'expo_eas_status',
          result: JSON.stringify({ status: 'ok', projectId: 'project-1' }),
          status: 'completed',
          timestamp: 1003,
        },
        {
          toolName: 'read_file',
          result: JSON.stringify({ status: 'ok', path: 'package.json', content: '{}' }),
          status: 'completed',
          timestamp: 1003.5,
        },
        {
          toolName: 'write_file',
          result: JSON.stringify({ status: 'ok', path: 'App.js' }),
          status: 'completed',
          timestamp: 1004,
        },
        {
          toolName: 'skill__github__commit_files',
          result: JSON.stringify({
            status: 'success',
            commitSha: 'abc123',
            pushed: true,
            changedFiles: ['package.json', 'App.tsx'],
          }),
          status: 'completed',
          timestamp: 1005,
        },
        {
          toolName: 'expo_eas_workflow_runs',
          result: JSON.stringify({
            status: 'ok',
            workflowRuns: [
              {
                id: 'run-1',
                status: 'IN_PROGRESS',
                createdAt: new Date(1006).toISOString(),
              },
            ],
          }),
          status: 'completed',
          timestamp: 1006,
        },
        {
          toolName: 'expo_eas_workflow_wait',
          result: JSON.stringify({
            status: 'ok',
            workflowRun: {
              id: 'run-1',
              status: 'COMPLETED',
              conclusion: 'success',
              createdAt: new Date(1006).toISOString(),
            },
          }),
          status: 'completed',
          timestamp: 1007,
        },
      ],
      {
        seedState: {
          ...buildInitialWorkflowRouteState(activation!, 999),
          facts: {
            finalizationHoldResumeCount: 2,
          },
        },
        timestamp: 1000,
      },
    );

    expect(state.status).not.toBe('blocked');
    expect(state.facts?.finalizationHoldResumeCount).toBe(2);
    expect(getMissingRequiredWorkflowToolNames(state, [
      'skill__github__repos',
      'skill__github__list_files',
      'expo_eas_list_projects',
      'expo_eas_status',
      'read_file',
      'write_file',
      'skill__github__commit_files',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_wait',
    ])).toEqual([]);
    expect(shouldHoldWorkflowRouteFinalization(state, [
      'skill__github__repos',
      'skill__github__list_files',
      'expo_eas_list_projects',
      'expo_eas_status',
      'read_file',
      'write_file',
      'skill__github__commit_files',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_wait',
    ])).toBe(false);
    expect(state.requiredToolNames).not.toContain('skill__github__create_issue');
  });

  it('treats ordinary tool argument and lookup errors as recoverable workflow feedback', () => {
    const activation = resolveWorkflowRouteActivation({
      routeMode: 'execution',
      requiredToolCategories: new Set(['workspace_files']),
      requiredCapabilities: new Set(['write']),
      plannedToolNames: new Set(['file_edit']),
      tools: [...tools, { name: 'file_edit', description: 'Edit a workspace file.' }],
    });
    expect(activation).toBeDefined();

    const state = buildInitialWorkflowRouteState(activation!, 1000);
    const advanced = advanceWorkflowRouteStateFromToolResult(
      state,
      {
        toolName: 'file_edit',
        result: 'Error: "oldText" is required for file_edit and must not be empty.',
        status: 'completed',
        timestamp: 2000,
      },
      tools,
    );

    expect(advanced?.status).toBe('active');
    expect(advanced?.facts?.lastRecoverableToolError).toContain('oldText');
    expect(buildWorkflowRouteRuntimeGuidance(activation, advanced, tools)).toContain(
      'Previous recoverable tool issue',
    );
  });
});
