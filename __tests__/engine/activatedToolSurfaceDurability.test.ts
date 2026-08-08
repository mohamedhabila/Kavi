import { resolveTurnToolSurface } from '../../src/engine/goals/toolSurface';
import { createGoal } from '../../src/engine/goals/types';
import { CORE_DOMAIN_TOOLS } from '../../src/engine/tools/domains/core';
import { tools } from '../helpers/turnToolSurfaceHarness';
import type { ToolDefinition } from '../../src/types/tool';

// Traced live on an Android emulator. A feasibility study needing Monte Carlo activated
// `python` through `tool_catalog`, ran it once successfully, and could never call it
// again: the activation was re-litigated every turn against the same "already observed"
// set that governs incidental continuation, and the waiver covered only `mcp__`/`skill__`
// names. Worse, that set keys off having been observed, so `tool_catalog` could not undo
// it — and `tool_catalog` is exactly what the off-surface refusal tells the run to do.
// The run alternated rejected `python` calls and useless `tool_catalog` calls until the
// iteration budget ran out. It had no legal move, and the whole run failed.

const pythonTool = (CORE_DOMAIN_TOOLS as ToolDefinition[]).find((tool) => tool.name === 'python');

if (!pythonTool) {
  throw new Error('python tool definition is required for this test');
}

const allTools: ToolDefinition[] = [...tools, pythonTool];

function surfaceNames(params: {
  observed?: string[];
  activated?: string[];
  recent?: string[];
  goals?: ReturnType<typeof createGoal>[];
  conversationMode?: 'chitchat';
}): string[] {
  return resolveTurnToolSurface({
    allTools,
    goals: params.goals ?? [],
    pendingAsyncMonitorToolNames: new Set(),
    observedToolNames: params.observed ?? [],
    recentContinuationToolNames: new Set(params.recent ?? []),
    activatedCatalogToolNames: new Set(params.activated ?? []),
    includeToolCatalog: true,
    ...(params.conversationMode ? { conversationMode: params.conversationMode } : {}),
  }).map((tool) => tool.name);
}

describe('an explicitly activated tool survives its own success', () => {
  it('keeps python on the surface after it has already run', () => {
    expect(surfaceNames({ activated: ['python'] })).toContain('python');
    expect(surfaceNames({ activated: ['python'], observed: ['python'] })).toContain('python');
  });

  it('keeps it across many successful runs, which is what a computation needs', () => {
    // Re-running a computation with different parameters is the normal case, not a replay.
    expect(
      surfaceNames({
        activated: ['python'],
        observed: ['python', 'tool_catalog', 'write_file', 'read_file'],
        recent: ['python'],
      }),
    ).toContain('python');
  });

  it('keeps it once a completed goal holds evidence produced by it', () => {
    // A completed goal citing `python:` evidence used to evict it through a second path.
    const completed = createGoal({
      id: 'compute',
      title: 'Run the simulation',
      status: 'completed',
      evidence: ['python:200000 trials'],
    });
    expect(
      surfaceNames({ activated: ['python'], observed: ['python'], goals: [completed] }),
    ).toContain('python');
  });
});

describe('the recovery the off-surface refusal names actually works', () => {
  it('restores an activated tool rather than leaving the run with no legal move', () => {
    const afterCatalogRetry = surfaceNames({
      activated: ['python'],
      observed: ['python', 'tool_catalog'],
      recent: ['tool_catalog'],
    });
    expect(afterCatalogRetry).toContain('python');
  });
});

describe('activation grants availability, never new authority', () => {
  it('still refuses a side-effectful non-memory tool activated in chitchat', () => {
    // Unchanged: discovery proves a tool exists, not that chat may mutate state with it.
    expect(
      surfaceNames({ activated: ['python'], conversationMode: 'chitchat' }),
    ).not.toContain('python');
  });

  it('does not put a tool on the surface merely because it was observed', () => {
    // Incidental continuation is still governed by the completion rules; only an
    // explicit activation is durable.
    expect(surfaceNames({ observed: ['python'] })).not.toContain('python');
  });

  it('ignores an activated name that is not a registered tool', () => {
    expect(surfaceNames({ activated: ['no_such_tool'] })).not.toContain('no_such_tool');
  });

  it('still retires a pure mutator once its write has landed', () => {
    // The discriminator is the contract, not the tool name. A tool declaring only `write`
    // has nothing further to contribute after it succeeds, and a second call means a
    // second effect — so the replay guard that `python` escapes still binds here.
    const pureMutator: ToolDefinition = {
      name: 'workspace_note_write',
      description: 'Write a non-core workspace note.',
      input_schema: { type: 'object', properties: {} },
      contract: {
        category: 'workspace_files',
        capabilities: ['write'],
        resourceKinds: ['conversation_workspace'],
        sideEffects: ['local_artifact'],
      },
    };
    const resolve = (observed: string[]) =>
      resolveTurnToolSurface({
        allTools: [...allTools, pureMutator],
        goals: [],
        pendingAsyncMonitorToolNames: new Set(),
        observedToolNames: observed,
        recentContinuationToolNames: new Set(),
        activatedCatalogToolNames: new Set(['workspace_note_write']),
        includeToolCatalog: true,
      }).map((tool) => tool.name);

    expect(resolve([])).toContain('workspace_note_write');
    expect(resolve(['workspace_note_write'])).not.toContain('workspace_note_write');
  });
});
