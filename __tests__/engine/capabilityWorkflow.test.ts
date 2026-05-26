import {
  advanceWorkflowRouteStateFromToolResult,
  buildWorkflowRouteFinalizationHoldGuidance,
  buildWorkflowRouteRuntimeGuidance,
  getMissingRequiredWorkflowToolNames,
  buildInitialWorkflowRouteState,
  resolveWorkflowRouteActivation,
  selectToolNamesForWorkflowRoutePhase,
  shouldHoldWorkflowRouteFinalization,
} from '../../src/engine/routes/agentRoutes';
import { inferToolCapabilityDescriptor } from '../../src/engine/tools/capabilityRegistry';

const tools = [
  { name: 'read_file', description: 'Read a workspace file.' },
  { name: 'list_files', description: 'List workspace files.' },
  { name: 'write_file', description: 'Write a local workspace file.' },
  { name: 'wait', description: 'Wait for a short period.' },
  { name: 'skill__github__repos', description: 'List repositories available to the token.' },
  { name: 'skill__github__issues', description: 'List issues for a repository.' },
  { name: 'skill__github__commit_files', description: 'Commit workspace files to a repository.' },
  { name: 'skill__github__create_issue', description: 'Create a GitHub issue.' },
  { name: 'expo_eas_list_projects', description: 'List linked Expo EAS projects.' },
  { name: 'expo_eas_status', description: 'Inspect linked Expo EAS project status.' },
  { name: 'expo_eas_workflow_runs', description: 'List Expo workflow runs.' },
  { name: 'expo_eas_workflow_wait', description: 'Wait for an external workflow run.' },
];

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
        'prepare_artifact',
        'persist_artifact',
        'mutate_remote_state',
        'monitor_external_execution',
        'verify_evidence',
      ]),
    );
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

  it('prefers broad repository discovery tools over unrelated resource readers', () => {
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

    expect(phaseTools).toContain('skill__github__repos');
    expect(phaseTools).not.toContain('skill__github__issues');
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
