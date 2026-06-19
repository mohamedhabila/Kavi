import {
  createInitialAgentControlGraphSnapshot,
  getAgentControlGraphMissingToolResultIds,
  getAgentControlGraphModelTurnBlocker,
  getAgentControlGraphTurnDirectives,
  reduceAgentControlGraph,
  selectAgentControlGraphRuntimeCommand,
} from '../../src/engine/graph/agentControlGraph';
import { buildAgentControlGraphAsyncWaitingEvent } from '../../src/engine/graph/asyncWorkEvents';
import { buildAgentControlGraphWorkflowToolResultProgress } from '../../src/engine/graph/workflowToolResultProgress';
import {
  isAgentRunControlGraphTerminal,
  prepareAgentRunControlGraphForResume,
} from '../../src/services/agents/agentControlGraphState';

describe('agent control graph', () => {
  it('blocks a new model turn until every expected tool result is observed', () => {
    let snapshot = createInitialAgentControlGraphSnapshot({ updatedAt: 1000 });

    snapshot = reduceAgentControlGraph(snapshot, [
      { type: 'MODEL_TURN_STARTED', iteration: 1, toolNames: ['read_resource'], timestamp: 1001 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: 'tool-call-1', name: 'read_resource' }],
        timestamp: 1002,
      },
    ]);

    expect(snapshot.status).toBe('awaiting_tool_results');
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual(['tool-call-1']);
    expect(getAgentControlGraphModelTurnBlocker(snapshot)).toContain('tool-call-1');

    snapshot = reduceAgentControlGraph(snapshot, [
      {
        type: 'TOOL_RESULT_RECORDED',
        result: { id: 'tool-call-1', name: 'read_resource' },
        timestamp: 1003,
      },
    ]);

    expect(snapshot.status).toBe('ready');
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual([]);
    expect(getAgentControlGraphModelTurnBlocker(snapshot)).toBeUndefined();
  });

  it('allows terminal finalization to close an intentionally abandoned tool boundary', () => {
    const waitingForTool = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 1 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: 'loop-call', name: 'read_file' }],
      },
    ]);

    expect(waitingForTool.status).toBe('awaiting_tool_results');
    expect(getAgentControlGraphModelTurnBlocker(waitingForTool)).toContain('loop-call');

    const finalized = reduceAgentControlGraph(waitingForTool, [
      { type: 'FINALIZED', reason: 'loop_detected', timestamp: 2000 },
    ]);

    expect(finalized).toEqual(
      expect.objectContaining({
        status: 'finalized',
        terminalReason: 'loop_detected',
        expectedToolCalls: [],
        observedToolResults: [],
      }),
    );
    expect(getAgentControlGraphModelTurnBlocker(finalized)).toContain('terminal (finalized)');
  });

  it('records cancellation as a terminal graph state and clears async waits', () => {
    const waitingForTool = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 1 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: 'cancel-call', name: 'read_file' }],
      },
    ]);

    const cancelled = reduceAgentControlGraph(waitingForTool, [
      { type: 'CANCELLED', reason: 'cancelled', timestamp: 3000 },
    ]);

    expect(cancelled).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        terminalReason: 'cancelled',
        expectedToolCalls: [],
        observedToolResults: [],
        pendingAsyncCount: 0,
        finalizationHoldReason: undefined,
      }),
    );
    expect(isAgentRunControlGraphTerminal(cancelled)).toBe(true);
    expect(getAgentControlGraphModelTurnBlocker(cancelled)).toContain('terminal (cancelled)');
  });

  it('records unhandled failures as terminal graph state and clears async waits', () => {
    const waitingAsync = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'ASYNC_WAITING', pendingAsyncCount: 2, timestamp: 4000 },
    ]);

    expect(waitingAsync.status).toBe('waiting_async');
    expect(waitingAsync.pendingAsyncCount).toBe(2);

    const failed = reduceAgentControlGraph(waitingAsync, [
      { type: 'FAILED', reason: 'provider unavailable', timestamp: 4001 },
    ]);

    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        terminalReason: 'provider unavailable',
        pendingAsyncCount: 0,
        expectedToolCalls: [],
        observedToolResults: [],
      }),
    );
    expect(isAgentRunControlGraphTerminal(failed)).toBe(true);
    expect(getAgentControlGraphModelTurnBlocker(failed)).toContain('terminal (failed)');
  });

  it('keeps parallel tool batches open until the last result arrives', () => {
    let snapshot = createInitialAgentControlGraphSnapshot();

    snapshot = reduceAgentControlGraph(snapshot, [
      { type: 'MODEL_TURN_STARTED', iteration: 2, toolNames: ['inspect', 'verify'] },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 2,
        toolCalls: [
          { id: 'a', name: 'inspect' },
          { id: 'b', name: 'verify' },
        ],
      },
      {
        type: 'TOOL_RESULT_RECORDED',
        result: { id: 'a', name: 'inspect' },
      },
    ]);

    expect(snapshot.status).toBe('awaiting_tool_results');
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual(['b']);

    snapshot = reduceAgentControlGraph(snapshot, [
      {
        type: 'TOOL_RESULT_RECORDED',
        result: { id: 'b', name: 'verify', failed: true },
      },
    ]);

    expect(snapshot.status).toBe('ready');
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual([]);
  });

  it('restores from a serialized pending boundary without losing invariants', () => {
    const pending = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 3, toolNames: ['mutate_remote_state'] },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 3,
        toolCalls: [{ id: 'mutation-1', name: 'mutate_remote_state' }],
      },
    ]);
    const restored = JSON.parse(JSON.stringify(pending));

    expect(getAgentControlGraphModelTurnBlocker(restored)).toContain('mutation-1');

    const completed = reduceAgentControlGraph(restored, [
      {
        type: 'TOOL_RESULT_RECORDED',
        result: { id: 'mutation-1', name: 'mutate_remote_state' },
      },
    ]);

    expect(completed.status).toBe('ready');
    expect(getAgentControlGraphModelTurnBlocker(completed)).toBeUndefined();
  });

  it('closes a failed model-turn boundary so provider retries can start cleanly', () => {
    let snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 7, toolNames: ['read_resource'] },
    ]);

    expect(snapshot.status).toBe('model_turn');
    expect(getAgentControlGraphModelTurnBlocker(snapshot)).toContain('already inside');

    snapshot = reduceAgentControlGraph(snapshot, [
      { type: 'MODEL_TURN_FAILED', iteration: 7, reason: 'provider_context_overflow' },
    ]);

    expect(snapshot.status).toBe('ready');
    expect(getAgentControlGraphModelTurnBlocker(snapshot)).toBeUndefined();
  });

  it('records compact performance metrics without changing control-flow state', () => {
    let snapshot = createInitialAgentControlGraphSnapshot({ updatedAt: 1000 });

    snapshot = reduceAgentControlGraph(snapshot, [
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1001,
        reason: 'request_tool_surface_resolved',
        metrics: {
          lastCandidateToolCount: 80,
          lastActiveToolCount: 12,
          lastActiveToolTokenEstimate: 1600,
        },
      },
      {
        type: 'PERFORMANCE_METRICS_RECORDED',
        timestamp: 1002,
        reason: 'model_turn_completed',
        metrics: {
          modelTurnCount: 1,
          modelDurationMs: 120,
          timeToFirstTokenMs: 15,
          lastActiveToolCount: 8,
          lastActiveToolTokenEstimate: 900,
        },
      },
    ]);

    expect(snapshot.status).toBe('ready');
    expect(snapshot.performance).toEqual(
      expect.objectContaining({
        modelTurnCount: 1,
        modelDurationMs: 120,
        timeToFirstTokenMs: 15,
        lastCandidateToolCount: 80,
        lastActiveToolCount: 8,
        maxActiveToolCount: 12,
        lastActiveToolTokenEstimate: 900,
        maxActiveToolTokenEstimate: 1600,
        updatedAt: 1002,
      }),
    );
    expect(snapshot.audit.at(-1)).toEqual(
      expect.objectContaining({
        type: 'PERFORMANCE_METRICS_RECORDED',
        detail: 'model_turn_completed',
      }),
    );
  });

  it('models recovery, async waiting, and terminal states generically', () => {
    const recovering = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'FINALIZATION_HELD', reason: 'required_evidence_missing' },
    ]);
    expect(recovering.status).toBe('recovering');
    expect(getAgentControlGraphModelTurnBlocker(recovering)).toBeUndefined();

    const waiting = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'ASYNC_WAITING', pendingAsyncCount: 2 },
    ]);
    expect(waiting.status).toBe('waiting_async');
    expect(waiting.pendingAsyncCount).toBe(2);
    expect(getAgentControlGraphModelTurnBlocker(waiting)).toBeUndefined();

    const blocked = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'BLOCKED', reason: 'missing_authorization' },
    ]);
    expect(blocked.status).toBe('blocked');
    expect(getAgentControlGraphModelTurnBlocker(blocked)).toContain('missing_authorization');
  });

  it('keeps the full async wait snapshot in graph state and clears it on terminal events', () => {
    const waiting = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        pendingOperations: [
          {
            key: 'session:sub-graph',
            kind: 'session',
            resourceId: 'sub-graph',
            displayName: 'Session sub-graph',
            status: 'running',
            lastUpdatedByTool: 'sessions_spawn',
            updatedAt: 5000,
            monitorToolNames: ['sessions_status', 'sessions_wait'],
            waitToolName: 'sessions_wait',
            waitArgs: { sessionId: 'sub-graph' },
          },
        ],
        timestamp: 5001,
      },
    ]);

    expect(waiting.status).toBe('waiting_async');
    expect(waiting.pendingAsyncCount).toBe(1);
    expect(waiting.asyncWork).toEqual(
      expect.objectContaining({
        awaitingBackgroundWorkers: false,
        pendingOperations: [
          expect.objectContaining({
            key: 'session:sub-graph',
            resourceId: 'sub-graph',
            waitToolName: 'sessions_wait',
          }),
        ],
      }),
    );

    const finalized = reduceAgentControlGraph(waiting, [
      { type: 'FINALIZED', reason: 'async_complete', timestamp: 5002 },
    ]);

    expect(finalized.asyncWork).toEqual(
      expect.objectContaining({
        awaitingBackgroundWorkers: false,
        pendingOperations: [],
        updatedAt: 5002,
      }),
    );
    expect(finalized.pendingAsyncCount).toBe(0);
  });

  it('clears completed async work without leaving the graph in waiting state', () => {
    const waiting = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        pendingOperations: [
          {
            key: 'session:sub-graph',
            kind: 'session',
            resourceId: 'sub-graph',
            displayName: 'Session sub-graph',
            status: 'running',
            lastUpdatedByTool: 'sessions_spawn',
            updatedAt: 5000,
            monitorToolNames: ['sessions_status', 'sessions_wait'],
            waitToolName: 'sessions_wait',
            waitArgs: { sessionId: 'sub-graph' },
          },
        ],
        timestamp: 5001,
      },
    ]);

    const cleared = reduceAgentControlGraph(waiting, [
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 0,
        pendingOperations: [],
        timestamp: 5002,
      },
    ]);

    expect(cleared.status).toBe('ready');
    expect(cleared.pendingAsyncCount).toBe(0);
    expect(cleared.asyncWork.pendingOperations).toEqual([]);
    expect(cleared.asyncWork.updatedAt).toBe(5002);

    const readyClear = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 0,
        pendingOperations: [],
        timestamp: 5003,
      },
    ]);

    expect(readyClear.status).toBe('ready');
    expect(readyClear.pendingAsyncCount).toBe(0);
  });

  it('builds async waiting events from pending operation state only', () => {
    const event = buildAgentControlGraphAsyncWaitingEvent(
      new Map([
        [
          'session:running',
          {
            key: 'session:running',
            kind: 'session',
            resourceId: 'running',
            displayName: 'Running session',
            status: 'running',
            lastUpdatedByTool: 'sessions_spawn',
            updatedAt: 5000,
            monitorToolNames: ['sessions_wait'],
          },
        ],
        [
          'session:complete',
          {
            key: 'session:complete',
            kind: 'session',
            resourceId: 'complete',
            displayName: 'Complete session',
            status: 'completed',
            lastUpdatedByTool: 'sessions_wait',
            updatedAt: 5001,
            monitorToolNames: ['sessions_wait'],
          },
        ],
      ]),
      { awaitingBackgroundWorkers: true, timestamp: 5002 },
    );

    expect(event).toEqual(
      expect.objectContaining({
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        awaitingBackgroundWorkers: true,
        timestamp: 5002,
      }),
    );
    expect(event.pendingOperations).toEqual([
      expect.objectContaining({
        key: 'session:running',
        status: 'running',
      }),
    ]);
  });

  it('tracks completed tool names from workflow tool result progress without graph mutation', () => {
    const progress = buildAgentControlGraphWorkflowToolResultProgress({
      toolMessage: {
        content: 'Wrote artifact.txt',
        timestamp: 4300,
        toolCalls: [
          {
            id: 'tc-write',
            name: 'write_file',
            arguments: '{"path":"artifact.txt","content":"done"}',
            status: 'completed',
          },
        ],
      },
      tools: [{ name: 'write_file', description: 'Write a local workspace file.' }],
      completedToolNames: [],
      reason: 'tool_result',
    });

    expect(progress).toEqual({
      observedToolName: 'write_file',
      newlyCompletedToolNames: ['write_file'],
      nextCompletedToolNames: ['write_file'],
    });
  });

  it('records and consumes one-shot turn directives while preserving recovery state', () => {
    const withDirectives = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'TURN_DIRECTIVES_RECORDED',
        reason: 'incomplete_delivery_continuation',
        timestamp: 3200,
        directives: {
          forceFinalText: true,
          forcedTextReason: 'incomplete_delivery_continuation',
          requireWorkflowTool: true,
          maxTokensOverride: 8192,
          incompleteFinalTextRecoveryCount: 2,
          incompleteFinalTextContinuationPrefix: 'partial answer',
        },
      },
    ]);

    expect(getAgentControlGraphTurnDirectives(withDirectives)).toEqual(
      expect.objectContaining({
        forceFinalText: true,
        forcedTextReason: 'incomplete_delivery_continuation',
        requireWorkflowTool: true,
        maxTokensOverride: 8192,
        incompleteFinalTextRecoveryCount: 2,
        incompleteFinalTextContinuationPrefix: 'partial answer',
      }),
    );

    const consumed = reduceAgentControlGraph(withDirectives, [
      { type: 'TURN_DIRECTIVES_CONSUMED', reason: 'model_turn_started', timestamp: 3201 },
    ]);

    expect(getAgentControlGraphTurnDirectives(consumed)).toEqual({
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 2,
      incompleteFinalTextContinuationPrefix: 'partial answer',
    });
  });

  it('selects the next runtime command from durable graph state', () => {
    const pendingToolResult = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 1 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: 'call-1', name: 'read_file' }],
      },
    ]);

    expect(selectAgentControlGraphRuntimeCommand(pendingToolResult)).toEqual(
      expect.objectContaining({
        type: 'blocked',
        reason: expect.stringContaining('call-1'),
      }),
    );

    const finalized = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'FINALIZED', reason: 'complete' },
    ]);

    expect(selectAgentControlGraphRuntimeCommand(finalized)).toEqual({
      type: 'terminal',
      status: 'finalized',
      reason: 'complete',
    });

    const awaitingReview = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'FINAL_CANDIDATE_READY', reason: 'stop' },
    ]);

    expect(awaitingReview).toEqual(
      expect.objectContaining({
        status: 'awaiting_review',
        expectedToolCalls: [],
        observedToolResults: [],
        terminalReason: 'stop',
      }),
    );
    expect(selectAgentControlGraphRuntimeCommand(awaitingReview)).toEqual(
      expect.objectContaining({
        type: 'blocked',
        reason: expect.stringContaining('final review'),
      }),
    );

    const forcedText = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'TURN_DIRECTIVES_RECORDED',
        directives: {
          forceFinalText: true,
          forcedTextReason: 'async_terminal_completion',
        },
      },
    ]);

    expect(selectAgentControlGraphRuntimeCommand(forcedText)).toEqual(
      expect.objectContaining({
        type: 'start_model_turn',
        directives: expect.objectContaining({
          forceFinalText: true,
        }),
      }),
    );
  });

  it('normalizes invalid turn directives without domain-specific behavior', () => {
    const snapshot = createInitialAgentControlGraphSnapshot({
      turnDirectives: {
        forceFinalText: true,
        forcedTextReason: 'github_workflow_runs' as never,
        requireWorkflowTool: false,
        maxTokensOverride: -10,
        incompleteFinalTextRecoveryCount: -1,
      },
    });

    expect(getAgentControlGraphTurnDirectives(snapshot)).toEqual({
      forceFinalText: true,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    });
    expect(JSON.stringify(snapshot.turnDirectives)).not.toMatch(/expo|github|eas/i);
  });

  it('prepares terminal invocation snapshots for running-run resumption', () => {
    const finalized = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'FINALIZED', reason: 'terminal_review_pending', timestamp: 4000 },
    ]);

    expect(getAgentControlGraphModelTurnBlocker(finalized)).toContain('terminal');

    const resumed = prepareAgentRunControlGraphForResume(finalized, {
      updatedAt: 4001,
      reason: 'pilot requested continuation',
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        status: 'ready',
        expectedToolCalls: [],
        observedToolResults: [],
        terminalReason: undefined,
        updatedAt: 4001,
      }),
    );
    expect(resumed?.audit.at(-1)).toEqual(
      expect.objectContaining({
        type: 'RUN_RESUMED_FROM_TERMINAL_GRAPH',
        detail: 'pilot requested continuation',
      }),
    );
    expect(getAgentControlGraphModelTurnBlocker(resumed)).toBeUndefined();
  });

  it('prepares final-candidate snapshots for pilot-requested continuation', () => {
    const awaitingReview = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'FINAL_CANDIDATE_READY', reason: 'stop', timestamp: 4000 },
    ]);

    expect(getAgentControlGraphModelTurnBlocker(awaitingReview)).toContain('final review');

    const resumed = prepareAgentRunControlGraphForResume(awaitingReview, {
      updatedAt: 4001,
      reason: 'pilot requested continuation',
    });

    expect(resumed).toEqual(
      expect.objectContaining({
        status: 'ready',
        terminalReason: undefined,
        updatedAt: 4001,
      }),
    );
    expect(getAgentControlGraphModelTurnBlocker(resumed)).toBeUndefined();
  });

  it('does not encode domain-specific tool behavior in graph state', () => {
    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 4, toolNames: ['external_monitor'] },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 4,
        toolCalls: [{ id: 'monitor-1', name: 'external_monitor' }],
      },
    ]);

    expect(JSON.stringify(snapshot)).not.toMatch(/expo|github|eas/i);
  });

  it('tracks representative tool families as opaque capabilities', () => {
    const representativeToolCalls = [
      { id: 'builtin-1', name: 'write_file' },
      { id: 'mcp-1', name: 'mcp__database__query' },
      { id: 'skill-1', name: 'skill__repository__commit' },
      { id: 'subagent-1', name: 'sessions_spawn' },
      { id: 'browser-1', name: 'browser_click' },
      { id: 'device-1', name: 'android_tap' },
      { id: 'memory-1', name: 'memory_search' },
      { id: 'monitor-1', name: 'ssh_wait_for_job' },
    ];

    let snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'MODEL_TURN_STARTED',
        iteration: 10,
        toolNames: representativeToolCalls.map((call) => call.name),
      },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 10,
        toolCalls: representativeToolCalls,
      },
    ]);

    expect(snapshot.status).toBe('awaiting_tool_results');
    expect(snapshot.expectedToolCalls).toEqual(representativeToolCalls);
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual(
      representativeToolCalls.map((call) => call.id),
    );

    snapshot = reduceAgentControlGraph(snapshot, [
      {
        type: 'TOOL_RESULTS_RECORDED',
        results: representativeToolCalls.map((call) => ({ ...call })),
      },
    ]);

    expect(snapshot.status).toBe('ready');
    expect(getAgentControlGraphMissingToolResultIds(snapshot)).toEqual([]);
  });

  it('caps the audit trail so long runs remain mobile-safe', () => {
    const events = Array.from({ length: 150 }, (_, index) => ({
      type: 'ASYNC_WAITING' as const,
      pendingAsyncCount: index,
      timestamp: 2000 + index,
    }));

    const snapshot = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), events);

    expect(snapshot.audit).toHaveLength(128);
    expect(snapshot.audit[0]?.timestamp).toBe(2022);
    expect(snapshot.audit.at(-1)?.timestamp).toBe(2149);
  });
});
