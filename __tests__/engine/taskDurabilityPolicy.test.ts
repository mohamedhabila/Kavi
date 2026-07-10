import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import {
  TASK_DURABILITY_CLASSES,
  classifyCurrentToolTaskDurability,
  qualifyExternalDurableHandle,
} from '../../src/engine/durability/taskDurability';
import { resolveToolEffectPolicy } from '../../src/engine/durability/toolEffectPolicy';

describe('task durability policy', () => {
  it('keeps the durability taxonomy closed and versionable', () => {
    expect(TASK_DURABILITY_CLASSES).toEqual([
      'foreground_interactive',
      'user_initiated_continuable',
      'deferrable_maintenance',
      'event_driven_monitor',
      'external_durable_operation',
    ]);
  });

  it('qualifies one exact Expo workflow run without claiming local resume', () => {
    const candidate = {
      version: 1 as const,
      kind: 'expo_workflow_run',
      sourceToolName: 'expo_eas_workflow_wait',
      projectId: '@kavi/mobile-app',
      workflowRunId: 'e0b8db2a-30f1-445d-a6df-729402b528d1',
      credentialRef: 'EXPO_TOKEN',
    };

    expect(qualifyExternalDurableHandle(candidate)).toEqual({
      version: 1,
      ...candidate,
    });
    expect(
      classifyCurrentToolTaskDurability({
        toolName: 'expo_eas_workflow_wait',
        externalHandle: candidate,
      }),
    ).toEqual({
      taskClass: 'external_durable_operation',
      localExecution: 'process_bound',
      recovery: 'reconcile_external_handle',
      externalHandle: { version: 1, ...candidate },
    });
  });

  it('does not synthesize a handle from GitHub list and aggregate status tools', () => {
    expect(
      qualifyExternalDurableHandle({
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'skill__github__workflow_runs',
        repository: 'OpenAI/Kavi-Mobile',
        workflowRunId: 123456789,
        credentialRef: 'GITHUB_TOKEN',
      }),
    ).toBeNull();
    expect(
      qualifyExternalDurableHandle({
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'skill__github__checks_status',
        repository: 'openai/kavi-mobile',
        workflowRunId: '123456789',
        credentialRef: 'GITHUB_TOKEN',
      }),
    ).toBeNull();
  });

  it('qualifies the exact GitHub run created by an Expo action tool', () => {
    expect(
      classifyCurrentToolTaskDurability({
        toolName: 'expo_eas_build',
        externalHandle: {
          version: 1,
          kind: 'github_workflow_run',
          sourceToolName: 'expo_eas_build',
          repository: 'OpenAI/Kavi-Mobile',
          workflowRunId: 123456789,
          credentialRef: 'PROJECT_GITHUB_TOKEN',
        },
      }),
    ).toEqual({
      taskClass: 'external_durable_operation',
      localExecution: 'process_bound',
      recovery: 'reconcile_external_handle',
      externalHandle: {
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'expo_eas_build',
        repository: 'openai/kavi-mobile',
        workflowRunId: '123456789',
        credentialRef: 'PROJECT_GITHUB_TOKEN',
      },
    });
  });

  it.each([
    [
      'missing handle version',
      {
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_workflow_wait',
        projectId: 'project-1',
        workflowRunId: 'run-1',
      },
    ],
    [
      'ambiguous run alias',
      {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_workflow_runs',
        projectId: 'project-1',
        workflowRunId: 'latest',
      },
    ],
    [
      'missing project',
      {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_workflow_wait',
        workflowRunId: 'run-1',
      },
    ],
    [
      'missing credential reference',
      {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_workflow_wait',
        projectId: 'project-1',
        workflowRunId: 'run-1',
      },
    ],
    [
      'source with surrounding whitespace',
      {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: ' expo_eas_workflow_wait ',
        projectId: 'project-1',
        workflowRunId: 'run-1',
      },
    ],
    [
      'project with surrounding whitespace',
      {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_workflow_wait',
        projectId: ' project-1 ',
        workflowRunId: 'run-1',
      },
    ],
    [
      'SSH job id',
      {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: 'ssh_background_job_wait',
        projectId: 'host-1',
        workflowRunId: 'bg-exec-1',
      },
    ],
    [
      'sub-agent session id',
      {
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'sessions_wait',
        repository: 'openai/kavi',
        workflowRunId: '123',
      },
    ],
    [
      'non-code-owned GitHub MCP',
      {
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'mcp__github__workflow_runs',
        repository: 'openai/kavi',
        workflowRunId: '123',
      },
    ],
    [
      'GitHub alias',
      {
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'skill__github__workflow_runs',
        repository: 'openai/kavi',
        workflowRunId: 'latest',
      },
    ],
    [
      'unsafe numeric GitHub id',
      {
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'skill__github__workflow_runs',
        repository: 'openai/kavi',
        workflowRunId: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
    [
      'malformed repository',
      {
        version: 1,
        kind: 'github_workflow_run',
        sourceToolName: 'skill__github__checks_status',
        repository: 'openai',
        workflowRunId: '123',
      },
    ],
    [
      'unknown handle kind',
      { version: 1, kind: 'session', sourceToolName: 'sessions_wait', sessionId: 'session-1' },
    ],
    [
      'unknown handle version',
      {
        version: 2,
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_workflow_wait',
        projectId: 'project-1',
        workflowRunId: 'run-1',
      },
    ],
  ])('rejects %s', (_label, candidate) => {
    expect(qualifyExternalDurableHandle(candidate)).toBeNull();
  });

  it('keeps absent, invalid, and mismatched handles foreground-only', () => {
    expect(classifyCurrentToolTaskDurability({ toolName: 'sessions_wait' })).toEqual({
      taskClass: 'foreground_interactive',
      localExecution: 'process_bound',
      recovery: 'not_resumable',
    });
    expect(
      classifyCurrentToolTaskDurability({
        toolName: 'expo_eas_workflow_status',
        externalHandle: {
          version: 1,
          kind: 'expo_workflow_run',
          sourceToolName: 'expo_eas_workflow_wait',
          projectId: 'project-1',
          workflowRunId: 'run-1',
          credentialRef: 'EXPO_TOKEN',
        },
      }).taskClass,
    ).toBe('foreground_interactive');
  });
});

describe('code-owned tool effect policy', () => {
  it('treats effect-free builtins as the only replay-safe calls', () => {
    expect(resolveToolEffectPolicy('read_file')).toEqual({
      toolName: 'read_file',
      source: 'builtin',
      effects: ['none'],
      idempotency: 'effect_free',
      retryPolicy: 'replay_safe',
    });
  });

  it('requires reconciliation even for declared-idempotent writes', () => {
    expect(resolveToolEffectPolicy('write_file')).toEqual({
      toolName: 'write_file',
      source: 'builtin',
      effects: ['local_artifact'],
      idempotency: 'declared_idempotent',
      retryPolicy: 'reconcile_before_retry',
    });
  });

  it('models JavaScript and Python as potentially mutating and not replay-safe', () => {
    expect(resolveToolEffectPolicy('javascript')).toEqual(
      expect.objectContaining({
        effects: ['local_artifact'],
        idempotency: 'not_declared',
        retryPolicy: 'reconcile_before_retry',
      }),
    );
    expect(resolveToolEffectPolicy('python')).toEqual(
      expect.objectContaining({
        effects: ['local_artifact', 'remote_mutation'],
        idempotency: 'not_declared',
        retryPolicy: 'reconcile_before_retry',
      }),
    );

    const javascript = TOOL_DEFINITIONS.find((tool) => tool.name === 'javascript');
    const python = TOOL_DEFINITIONS.find((tool) => tool.name === 'python');
    expect(javascript?.contract?.riskHints).not.toContain('idempotent');
    expect(python?.contract?.riskHints).toEqual(['open_world', 'requires_approval']);
  });

  it('never treats external execution as replay-safe without reconciliation', () => {
    expect(resolveToolEffectPolicy('expo_eas_build')).toEqual(
      expect.objectContaining({
        effects: ['external_run'],
        idempotency: 'not_declared',
        retryPolicy: 'reconcile_before_retry',
      }),
    );
  });

  it('fails closed for unknown dynamic contracts but trusts the bundled GitHub skill', () => {
    expect(resolveToolEffectPolicy('mcp__third_party__read')).toEqual({
      toolName: 'mcp__third_party__read',
      source: 'unknown',
      effects: ['unknown'],
      idempotency: 'unknown',
      retryPolicy: 'never_retry_automatically',
    });
    expect(resolveToolEffectPolicy('skill__github__workflow_runs')).toEqual(
      expect.objectContaining({
        source: 'github_skill',
        effects: ['none'],
        retryPolicy: 'replay_safe',
      }),
    );
    expect(resolveToolEffectPolicy('mcp__github__workflow_runs').source).toBe('unknown');
  });

  it('has a closed effect policy for every registered builtin', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const policy = resolveToolEffectPolicy(tool.name);
      expect(policy.source).toBe('builtin');
      expect(policy.effects).not.toContain('unknown');
      expect(policy.effects.length).toBeGreaterThan(0);
    }
  });
});
