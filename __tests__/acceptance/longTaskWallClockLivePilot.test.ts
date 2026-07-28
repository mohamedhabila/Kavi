jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

import { installE2EScenarioEnvironment } from '../../src/acceptance/e2eAgent/e2eScenarioEnvironment';
import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { buildE2EProvider } from '../../src/acceptance/e2eAgent/providerConfig';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import {
  readWorkspaceRelativeFile,
  resetE2EWorkspaceSandbox,
} from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import {
  __resetSubAgentStateForTests,
  cancelSubAgent,
  getSubAgentsByParent,
  listActiveSubAgents,
  waitForSubAgentCompletion,
} from '../../src/services/agents/subAgent';
import {
  registerInternalHook,
  unregisterInternalHook,
} from '../../src/services/events/bus';
import type { InternalHookEvent } from '../../src/services/events/types';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const describeLivePilot =
  process.env.RUN_LONG_TASK_WALL_CLOCK_PILOT === '1' ? describe : describe.skip;

const MINUTE_MS = 60_000;

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

const REQUIRED_WAIT_COUNT = readBoundedInteger('LONG_TASK_PILOT_WAIT_COUNT', 15, 3, 20);
const WAIT_DURATION_MS = readBoundedInteger(
  'LONG_TASK_PILOT_WAIT_MS',
  MINUTE_MS,
  100,
  MINUTE_MS,
);
const INTER_TURN_DELAY_MS = readBoundedInteger(
  'LONG_TASK_PILOT_INTER_TURN_DELAY_MS',
  REQUIRED_WAIT_COUNT * WAIT_DURATION_MS,
  100,
  20 * MINUTE_MS,
);
const WAIT_DURATION_TOLERANCE_MS = Math.min(
  1_000,
  Math.max(25, Math.floor(WAIT_DURATION_MS * 0.05)),
);
const MINIMUM_OBSERVED_WORK_MS =
  REQUIRED_WAIT_COUNT * (WAIT_DURATION_MS - WAIT_DURATION_TOLERANCE_MS);
const ARTIFACT_PATH = 'artifacts/fifteen-minute-continuity-check.json';
const COMPLETION_MARKER = `LONG_TASK_COMPLETE_${REQUIRED_WAIT_COUNT}`;
const IS_CLAIM_PROFILE =
  REQUIRED_WAIT_COUNT === 15 &&
  WAIT_DURATION_MS === MINUTE_MS &&
  INTER_TURN_DELAY_MS === 15 * MINUTE_MS;

type ToolObservation = {
  action: 'tool_start' | 'tool_end';
  at: number;
  sessionId: string;
  toolName: string;
};

type WorkerSample = {
  at: number;
  sessionId: string;
  status: string;
  launchState: string | null;
  activeToolName: string | null;
  currentActivity: string | null;
  updatedAt: number;
};

function parseToolArguments(argumentsText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function resolveEvidencePath(runId: string): string {
  const projectRoot = path.resolve(__dirname, '../..');
  const privateRoot = path.join(projectRoot, '.private');
  const configured = process.env.LONG_TASK_EVIDENCE_PATH?.trim();
  const evidencePath = path.resolve(
    configured || path.join(privateRoot, 'evals', 'long-task-wall-clock', `${runId}.json`),
  );
  if (evidencePath !== privateRoot && !evidencePath.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error('LONG_TASK_EVIDENCE_PATH must stay inside the project .private directory.');
  }
  return evidencePath;
}

function pairToolObservations(
  observations: ReadonlyArray<ToolObservation>,
  toolName: string,
): Array<{ startedAt: number; completedAt: number; durationMs: number }> {
  const starts = observations.filter(
    (observation) => observation.toolName === toolName && observation.action === 'tool_start',
  );
  const ends = observations.filter(
    (observation) => observation.toolName === toolName && observation.action === 'tool_end',
  );
  return starts.slice(0, Math.min(starts.length, ends.length)).map((start, index) => ({
    startedAt: start.at,
    completedAt: ends[index]!.at,
    durationMs: ends[index]!.at - start.at,
  }));
}

async function stopAndResetWorkers(): Promise<void> {
  const running = listActiveSubAgents().filter((worker) => worker.status === 'running');
  for (const worker of running) {
    cancelSubAgent(worker.sessionId, 'Wall-clock live pilot cleanup.');
  }
  await Promise.all(
    running.map((worker) =>
      waitForSubAgentCompletion(worker.sessionId, 10_000).catch(() => null),
    ),
  );
  await __resetSubAgentStateForTests();
}

describeLivePilot('long task — real foreground-chat wall-clock pilot', () => {
  jest.setTimeout(Math.max(10 * MINUTE_MS, INTER_TURN_DELAY_MS + 13 * MINUTE_MS));

  afterAll(async () => {
    await stopAndResetWorkers();
    teardownE2EMemorySandbox();
  });

  it('keeps one delegated worker active through sequential waits and retrieves its verified result after chat relaunch', async () => {
    resetE2EMemorySandbox();
    resetE2EWorkspaceSandbox();
    await stopAndResetWorkers();
    await useSettingsStore.persist.rehydrate();

    const provider = buildE2EProvider();
    const runId = `long-task-wall-clock-${Date.now()}`;
    const conversationId = runId;
    const evidencePath = resolveEvidencePath(runId);
    const toolObservations: ToolObservation[] = [];
    const workerSamples: WorkerSample[] = [];
    const rubricFailures: string[] = [];
    const startedAt = Date.now();
    let driverResult: Awaited<ReturnType<typeof runForegroundScenario>> | null = null;
    let executionError: string | null = null;
    let lastProgressLogSignature = '';

    const observeTool = (event: InternalHookEvent): void => {
      if (
        event.type !== 'agent' ||
        (event.action !== 'tool_start' && event.action !== 'tool_end') ||
        typeof event.context.toolName !== 'string'
      ) {
        return;
      }
      toolObservations.push({
        action: event.action,
        at: event.timestamp.getTime(),
        sessionId: event.sessionKey,
        toolName: event.context.toolName,
      });
    };
    registerInternalHook('agent:tool_start', observeTool);
    registerInternalHook('agent:tool_end', observeTool);

    const sampleWorkers = (): void => {
      const workers = getSubAgentsByParent(conversationId);
      for (const worker of workers) {
        workerSamples.push({
          at: Date.now(),
          sessionId: worker.sessionId,
          status: worker.status,
          launchState: worker.launchState ?? null,
          activeToolName: worker.activeToolName ?? null,
          currentActivity: worker.currentActivity ?? null,
          updatedAt: worker.updatedAt,
        });
      }
      const latest = workers[workers.length - 1];
      const completedWaits = toolObservations.filter(
        (observation) => observation.toolName === 'wait' && observation.action === 'tool_end',
      ).length;
      const logSignature = [
        latest?.status ?? 'not-started',
        latest?.activeToolName ?? latest?.launchState ?? 'none',
        completedWaits,
      ].join(':');
      if (logSignature !== lastProgressLogSignature) {
        lastProgressLogSignature = logSignature;
        console.log(
          `[long-task-live] elapsedSec=${Math.floor((Date.now() - startedAt) / 1_000)} ` +
            `worker=${latest?.status ?? 'not-started'} activity=${latest?.activeToolName ?? latest?.launchState ?? 'none'} ` +
            `completedWaits=${completedWaits}/${REQUIRED_WAIT_COUNT}`,
        );
      }
    };
    const monitor = setInterval(
      sampleWorkers,
      Math.min(MINUTE_MS, Math.max(50, WAIT_DURATION_MS)),
    );
    sampleWorkers();

    const uninstallEnvironment = installE2EScenarioEnvironment();
    try {
      driverResult = await runForegroundScenario({
        provider,
        conversationId,
        conversationTitle: 'Fifteen-minute continuity check',
        systemPrompt: useSettingsStore.getState().systemPrompt,
        defaultMode: 'agentic',
        scenarioTimeoutMs: INTER_TURN_DELAY_MS + 12 * MINUTE_MS,
        memoryTimeoutMs: 30_000,
        maxTokens: 3_072,
        disableLongTermMemory: true,
        allowedToolNames: [
          'sessions_spawn',
          'sessions_list',
          'sessions_status',
          'sessions_wait',
          'sessions_output',
          'sessions_surface_output',
          'write_file',
          'read_file',
        ],
        turns: [
          {
            route: 'forced_agentic',
            selectedMode: 'agentic',
            timeoutMs: 3 * MINUTE_MS,
            content:
              `Start one background delegated worker named \`fifteen-minute-continuity-check\` and reply as soon as it is running; do not block this chat until it finishes. Give that worker only the \`wait\` tool; it must not receive file or mutation tools. Its task is: call \`wait\` with \`ms: ${WAIT_DURATION_MS}\` exactly ${REQUIRED_WAIT_COUNT} times sequentially, never in parallel. Use a distinct reason from \`checkpoint 01/${String(REQUIRED_WAIT_COUNT).padStart(2, '0')}\` through \`checkpoint ${String(REQUIRED_WAIT_COUNT).padStart(2, '0')}/${String(REQUIRED_WAIT_COUNT).padStart(2, '0')}\` so every completed wait is explicit. Do not finish early. After the final wait completes, return exactly the marker \`${COMPLETION_MARKER}\` and the completed wait count; do not create any artifact. Use \`sessions_spawn\` with background execution; do not wait for completion in this first reply.`,
          },
          {
            delayBeforeMs: INTER_TURN_DELAY_MS,
            lifecycleBefore: 'app_relaunch',
            route: 'forced_agentic',
            selectedMode: 'agentic',
            timeoutMs: 5 * MINUTE_MS,
            content:
              `Resume from the persisted chat. Check the existing \`fifteen-minute-continuity-check\` worker; do not start another worker. If it is still running, wait for that same session to finish. Retrieve its final output. Only after it confirms the exact marker \`${COMPLETION_MARKER}\` and ${REQUIRED_WAIT_COUNT} completed sequential waits, write exactly one JSON artifact at \`${ARTIFACT_PATH}\` containing \`${JSON.stringify({ marker: COMPLETION_MARKER, completedSequentialWaits: REQUIRED_WAIT_COUNT, status: 'verified' })}\`. Read that file back exactly once, verify those fields, and report the verified result.`,
          },
        ],
      });
    } catch (error) {
      executionError = error instanceof Error ? error.message : String(error);
      rubricFailures.push(`foreground_driver_error:${executionError}`);
    } finally {
      clearInterval(monitor);
      sampleWorkers();
      uninstallEnvironment();
      unregisterInternalHook('agent:tool_start', observeTool);
      unregisterInternalHook('agent:tool_end', observeTool);
    }

    const completedAt = Date.now();
    const workers = getSubAgentsByParent(conversationId);
    const worker = workers[0] ?? null;
    const waitPairs = pairToolObservations(toolObservations, 'wait');
    const writePairs = pairToolObservations(toolObservations, 'write_file');
    const readPairs = pairToolObservations(toolObservations, 'read_file');
    const observedWorkMs =
      waitPairs.length > 0
        ? waitPairs[waitPairs.length - 1]!.completedAt - waitPairs[0]!.startedAt
        : 0;
    const waitsWereSequential = waitPairs.every(
      (pair, index) => index === 0 || pair.startedAt >= waitPairs[index - 1]!.completedAt,
    );
    const artifactCommittedAfterLongWork =
      waitPairs.length > 0 &&
      writePairs.length > 0 &&
      writePairs[0]!.startedAt >= waitPairs[waitPairs.length - 1]!.completedAt;
    const eachWaitMetDuration = waitPairs.every(
      (pair) => pair.durationMs >= WAIT_DURATION_MS - WAIT_DURATION_TOLERANCE_MS,
    );
    const artifactText = readWorkspaceRelativeFile(conversationId, ARTIFACT_PATH) ?? null;
    let artifact: Record<string, unknown> | null = null;
    if (artifactText) {
      try {
        const parsed = JSON.parse(artifactText) as unknown;
        artifact =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        artifact = null;
      }
    }

    const allTurnToolCalls = Array.from(
      new Map(
        (driverResult?.turns.flatMap((turn) =>
          turn.messages.flatMap((message) => message.toolCalls ?? []),
        ) ?? []).map((toolCall) => [toolCall.id, toolCall]),
      ).values(),
    );
    const spawnCalls = allTurnToolCalls.filter((toolCall) => toolCall.name === 'sessions_spawn');
    const spawnArguments = spawnCalls[0] ? parseToolArguments(spawnCalls[0].arguments) : null;
    const turnsCompleted =
      driverResult?.turns.length === 2 &&
      driverResult.turns.every(
        (turn) =>
          !turn.timedOut &&
          !turn.error &&
          turn.completion.executionCompleted &&
          turn.completion.finalResponseCompleted,
      );

    if (!turnsCompleted) rubricFailures.push('chat_turns_not_completed');
    if (driverResult?.turns[1]?.lifecycleBefore?.boundary !== 'app_relaunch') {
      rubricFailures.push('persisted_chat_relaunch_not_observed');
    }
    if (spawnCalls.length !== 1) rubricFailures.push(`spawn_count:${spawnCalls.length}`);
    if (spawnArguments?.waitForCompletion === true) {
      rubricFailures.push('spawn_blocked_first_chat_turn');
    }
    if (
      !Array.isArray(spawnArguments?.tools) ||
      spawnArguments.tools.length !== 1 ||
      spawnArguments.tools[0] !== 'wait'
    ) {
      rubricFailures.push('worker_tool_scope_not_wait_only');
    }
    if (workers.length !== 1) rubricFailures.push(`worker_count:${workers.length}`);
    if (worker?.status !== 'completed') rubricFailures.push(`worker_status:${worker?.status}`);
    if (worker?.completionState && worker.completionState !== 'verified_success') {
      rubricFailures.push(`worker_completion_state:${worker?.completionState}`);
    }
    if (waitPairs.length !== REQUIRED_WAIT_COUNT) {
      rubricFailures.push(`completed_wait_count:${waitPairs.length}`);
    }
    if (!waitsWereSequential) rubricFailures.push('waits_overlapped');
    if (!eachWaitMetDuration) rubricFailures.push('wait_duration_below_requested_duration');
    if (observedWorkMs < MINIMUM_OBSERVED_WORK_MS) {
      rubricFailures.push(`observed_work_too_short_ms:${observedWorkMs}`);
    }
    if (
      !worker?.output?.includes(COMPLETION_MARKER) ||
      !worker.output.includes(String(REQUIRED_WAIT_COUNT))
    ) {
      rubricFailures.push('worker_output_missing_completion_evidence');
    }
    if (worker?.toolsUsed?.some((toolName) => toolName !== 'wait')) {
      rubricFailures.push('worker_used_mutation_tool');
    }
    if (writePairs.length !== 1) rubricFailures.push(`artifact_write_count:${writePairs.length}`);
    if (readPairs.length !== 1) rubricFailures.push(`artifact_read_count:${readPairs.length}`);
    if (!artifactCommittedAfterLongWork) rubricFailures.push('artifact_committed_before_long_work');
    if (
      artifact?.marker !== COMPLETION_MARKER ||
      artifact.completedSequentialWaits !== REQUIRED_WAIT_COUNT ||
      artifact.status !== 'verified'
    ) {
      rubricFailures.push('artifact_content_not_verified');
    }
    if (!workerSamples.some((sample) => sample.status === 'running')) {
      rubricFailures.push('no_running_worker_sample');
    }

    const evidence = {
      schemaVersion: 1,
      runId,
      profile: {
        claimEligible: IS_CLAIM_PROFILE,
        requiredWaitCount: REQUIRED_WAIT_COUNT,
        waitDurationMs: WAIT_DURATION_MS,
        interTurnDelayMs: INTER_TURN_DELAY_MS,
      },
      provider: { family: provider.providerFamily, model: provider.model },
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startedAt,
      executionError,
      rubric: {
        passed: rubricFailures.length === 0,
        failures: rubricFailures,
        requiredWaitCount: REQUIRED_WAIT_COUNT,
        completedWaitCount: waitPairs.length,
        waitsWereSequential,
        eachWaitMetDuration,
        observedWorkMs,
        artifactWriteCount: writePairs.length,
        artifactReadCount: readPairs.length,
        artifactCommittedAfterLongWork,
        artifactVerified:
          artifact?.marker === COMPLETION_MARKER &&
          artifact.completedSequentialWaits === REQUIRED_WAIT_COUNT &&
          artifact.status === 'verified',
      },
      chat: {
        turnCount: driverResult?.turns.length ?? 0,
        completions: driverResult?.turns.map((turn) => turn.completion) ?? [],
        durationsMs: driverResult?.turns.map((turn) => turn.durationMs) ?? [],
        lifecycle: driverResult?.turns.map((turn) => turn.lifecycleBefore) ?? [],
        assistants: driverResult?.turns.map((turn) => turn.finalAssistant?.text ?? null) ?? [],
        usage: driverResult?.turns.map((turn) => turn.usage) ?? [],
        spawnCount: spawnCalls.length,
        spawnArguments,
        toolCalls: allTurnToolCalls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          arguments: parseToolArguments(toolCall.arguments),
          status: toolCall.status,
          startedAt: toolCall.startedAt ?? null,
          completedAt: toolCall.completedAt ?? null,
          result: toolCall.result ?? null,
          error: toolCall.error ?? null,
        })),
      },
      worker: worker
        ? {
            sessionId: worker.sessionId,
            status: worker.status,
            completionState: worker.completionState ?? null,
            terminationCause: worker.terminationCause ?? null,
            startedAt: new Date(worker.startedAt).toISOString(),
            updatedAt: new Date(worker.updatedAt).toISOString(),
            iterations: worker.iterations ?? null,
            toolsUsed: worker.toolsUsed ?? [],
            output: worker.output ?? null,
          }
        : null,
      toolTimeline: toolObservations.map((observation) => ({
        ...observation,
        atIso: new Date(observation.at).toISOString(),
      })),
      waitDurations: waitPairs,
      progressSamples: workerSamples.map((sample) => ({
        ...sample,
        atIso: new Date(sample.at).toISOString(),
      })),
      artifact: artifactText
        ? {
            path: ARTIFACT_PATH,
            sha256: createHash('sha256').update(artifactText).digest('hex'),
            content: artifact,
          }
        : null,
    };
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[long-task-live] evidence=${evidencePath}`);

    await stopAndResetWorkers();
    expect(rubricFailures).toEqual([]);
  });
});
