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
  { name: 'expo_eas_list_projects', description: 'List linked Expo EAS projects.' },
  { name: 'expo_eas_status', description: 'Inspect linked Expo EAS project status.' },
  { name: 'expo_eas_workflow_runs', description: 'List Expo workflow runs.' },
  { name: 'expo_eas_workflow_wait', description: 'Wait for an external workflow run.' },
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
          result: JSON.stringify({ status: 'success', commitSha: 'abc123', pushed: true }),
          status: 'completed',
          timestamp: 1005,
        },
        {
          toolName: 'expo_eas_workflow_runs',
          result: JSON.stringify({ status: 'ok', workflowRuns: [{ id: 'run-1' }] }),
          status: 'completed',
          timestamp: 1006,
        },
        {
          toolName: 'expo_eas_workflow_wait',
          result: JSON.stringify({ status: 'completed', conclusion: 'success', id: 'run-1' }),
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
