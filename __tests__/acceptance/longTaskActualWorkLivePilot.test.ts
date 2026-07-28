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
  seedE2EWorkspaceSandbox,
} from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import {
  __resetSubAgentStateForTests,
  cancelSubAgent,
  listActiveSubAgents,
  waitForSubAgentCompletion,
} from '../../src/services/agents/subAgent';
import { registerInternalHook, unregisterInternalHook } from '../../src/services/events/bus';
import type { InternalHookEvent } from '../../src/services/events/types';
import type { SubAgentSnapshot } from '../../src/types/subAgent';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import {
  ACTUAL_WORK_PACKET_COUNT as PACKET_COUNT,
  actualWorkPacketPath as packetPath,
  buildActualWorkSourcePackets as buildSourcePackets,
} from '../../testSupport/longTaskActualWork/packets';
import {
  measureWorkerDurationMs,
  summarizeWorker,
  summarizeWorkerToolTranscript,
} from '../../testSupport/longTaskActualWork/evidence';
import {
  buildActualWorkContinuationPrompt,
  buildActualWorkFinalReviewPrompt,
  buildActualWorkPrimaryPrompt,
  CHECKPOINT_PATHS,
  EXECUTION_PLAN_PATH,
  PRIMARY_MARKER,
  PRIMARY_REPORT_PATH,
  REMEDIATOR_MARKER,
  VERIFIED_REPORT_PATH,
  VERIFIER_MARKER,
} from '../../testSupport/longTaskActualWork/prompts';
const describeLivePilot =
  process.env.RUN_LONG_TASK_ACTUAL_WORK_PILOT === '1' ? describe : describe.skip;
const MINUTE_MS = 60_000;
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INITIAL_MONITOR_DELAY_MS = 30_000;
const TARGET_MIN_ACTIVE_WORK_MS = 14 * MINUTE_MS;
const TARGET_MAX_ACTIVE_WORK_MS = 25 * MINUTE_MS;
const MAX_SINGLE_STAGE_MS = 12 * MINUTE_MS;
type ToolObservation = {
  action: 'tool_start' | 'tool_end';
  at: number;
  sessionId: string;
  toolName: string;
};
type WorkerSample = {
  at: number;
  sessionId: string;
  name: string | null;
  status: string;
  launchState: string | null;
  activeToolName: string | null;
  currentActivity: string | null;
  iterations: number | null;
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
  const privateRoot = path.join(PROJECT_ROOT, '.private');
  const configured = process.env.LONG_TASK_ACTUAL_WORK_EVIDENCE_PATH?.trim();
  const evidencePath = path.resolve(
    configured || path.join(privateRoot, 'evals', 'long-task-actual-work', `${runId}.json`),
  );
  if (evidencePath !== privateRoot && !evidencePath.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error('LONG_TASK_ACTUAL_WORK_EVIDENCE_PATH must stay inside .private.');
  }
  return evidencePath;
}

function workerToolCount(
  observations: ReadonlyArray<ToolObservation>,
  sessionId: string | undefined,
  toolName: string,
): number {
  return observations.filter(
    (entry) =>
      entry.sessionId === sessionId && entry.action === 'tool_end' && entry.toolName === toolName,
  ).length;
}

function includesAllEvidenceTokens(text: string | null): boolean {
  return Array.from({ length: PACKET_COUNT }, (_, index) =>
    text?.includes(`ARCH_EVIDENCE_${String(index + 1).padStart(2, '0')}`),
  ).every(Boolean);
}

async function stopAndResetWorkers(): Promise<void> {
  const running = listActiveSubAgents().filter((worker) => worker.status === 'running');
  for (const worker of running) cancelSubAgent(worker.sessionId, 'Actual-work pilot cleanup.');
  await Promise.all(
    running.map((worker) => waitForSubAgentCompletion(worker.sessionId, 10_000).catch(() => null)),
  );
  await __resetSubAgentStateForTests();
}

describeLivePilot('long task — real substantive architecture audit', () => {
  jest.setTimeout(42 * MINUTE_MS);

  afterAll(async () => {
    await stopAndResetWorkers();
    teardownE2EMemorySandbox();
  });

  it('completes a monitored three-stage source audit without using waits as worker work', async () => {
    resetE2EMemorySandbox();
    resetE2EWorkspaceSandbox();
    await stopAndResetWorkers();
    await useSettingsStore.persist.rehydrate();

    const provider = buildE2EProvider();
    const runId = `long-task-actual-work-${Date.now()}`;
    const conversationId = runId;
    const evidencePath = resolveEvidencePath(runId);
    const packetPaths = Array.from({ length: PACKET_COUNT }, (_, index) => packetPath(index));
    const toolObservations: ToolObservation[] = [];
    const workerSamples: WorkerSample[] = [];
    const rubricFailures: string[] = [];
    const watchdogCancelledSessionIds: string[] = [];
    const startedAt = Date.now();
    let driverResult: Awaited<ReturnType<typeof runForegroundScenario>> | null = null;
    let executionError: string | null = null;
    let lastProgressSignature = '';
    mkdirSync(path.dirname(evidencePath), { recursive: true });

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
      if (event.action === 'tool_end') {
        const worker = listActiveSubAgents().find(
          (candidate) => candidate.sessionId === event.sessionKey,
        );
        const completedTools = toolObservations.filter(
          (entry) => entry.sessionId === event.sessionKey && entry.action === 'tool_end',
        ).length;
        console.log(
          `[actual-work-live] elapsedSec=${Math.floor((Date.now() - startedAt) / 1_000)} ` +
            `actor=${worker?.name ?? 'foreground-chat'} toolEnd=${event.context.toolName} ` +
            `completedTools=${completedTools}`,
        );
      }
    };
    registerInternalHook('agent:tool_start', observeTool);
    registerInternalHook('agent:tool_end', observeTool);

    const persistProgressEvidence = (workers: ReadonlyArray<SubAgentSnapshot>): void => {
      const partialEvidence = {
        schemaVersion: 1,
        partial: true,
        runId,
        provider: { family: provider.providerFamily, model: provider.model },
        startedAt: new Date(startedAt).toISOString(),
        sampledAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        maxSingleStageMs: MAX_SINGLE_STAGE_MS,
        watchdogCancelledSessionIds,
        workers: workers.map((worker) => ({
          sessionId: worker.sessionId,
          name: worker.name ?? null,
          status: worker.status,
          startedAt: new Date(worker.startedAt).toISOString(),
          updatedAt: new Date(worker.updatedAt).toISOString(),
          iterations: worker.iterations ?? null,
          activeToolName: worker.activeToolName ?? null,
          currentActivity: worker.currentActivity ?? null,
        })),
        workerToolTranscripts: Object.fromEntries(
          workers.map((worker) => [worker.sessionId, summarizeWorkerToolTranscript(worker)]),
        ),
        toolTimeline: toolObservations.map((entry) => ({
          ...entry,
          atIso: new Date(entry.at).toISOString(),
        })),
        progressSamples: workerSamples,
      };
      writeFileSync(evidencePath, `${JSON.stringify(partialEvidence, null, 2)}\n`, 'utf8');
    };

    const sampleWorkers = (): void => {
      const workers = listActiveSubAgents().filter(
        (worker) => worker.parentConversationId === conversationId,
      );
      const sampledAt = Date.now();
      for (const worker of workers) {
        if (
          worker.status === 'running' &&
          sampledAt - worker.startedAt > MAX_SINGLE_STAGE_MS &&
          !watchdogCancelledSessionIds.includes(worker.sessionId)
        ) {
          watchdogCancelledSessionIds.push(worker.sessionId);
          cancelSubAgent(worker.sessionId, 'Actual-work pilot stage exceeded 12 minutes.');
        }
      }
      for (const worker of workers) {
        workerSamples.push({
          at: sampledAt,
          sessionId: worker.sessionId,
          name: worker.name ?? null,
          status: worker.status,
          launchState: worker.launchState ?? null,
          activeToolName: worker.activeToolName ?? null,
          currentActivity: worker.currentActivity ?? null,
          iterations: worker.iterations ?? null,
        });
      }
      const signature = workers
        .map(
          (worker) =>
            `${worker.name}:${worker.status}:${worker.activeToolName ?? worker.launchState}:${worker.iterations ?? 0}`,
        )
        .join('|');
      if (signature !== lastProgressSignature) {
        lastProgressSignature = signature;
        console.log(
          `[actual-work-live] elapsedSec=${Math.floor((Date.now() - startedAt) / 1_000)} ` +
            `workers=${signature || 'not-started'}`,
        );
      }
      persistProgressEvidence(workers);
    };
    const monitor = setInterval(sampleWorkers, 10_000);
    sampleWorkers();

    const primaryPrompt = buildActualWorkPrimaryPrompt(packetPaths);
    const continuationPrompt = buildActualWorkContinuationPrompt(packetPaths);
    const finalReviewPrompt = buildActualWorkFinalReviewPrompt();

    const uninstallEnvironment = installE2EScenarioEnvironment();
    try {
      driverResult = await runForegroundScenario({
        provider,
        conversationId,
        conversationTitle: 'Long-running architecture audit',
        systemPrompt: useSettingsStore.getState().systemPrompt,
        defaultMode: 'agentic',
        scenarioTimeoutMs: 32 * MINUTE_MS,
        memoryTimeoutMs: 30_000,
        maxTokens: 4_096,
        disableLongTermMemory: true,
        enableCompaction: true,
        beforeTurns: ({ conversationId: seededConversationId }) => {
          useSettingsStore.setState({ thinkingLevel: 'minimal' });
          seedE2EWorkspaceSandbox(seededConversationId, buildSourcePackets());
        },
        turns: [
          {
            route: 'forced_agentic',
            selectedMode: 'agentic',
            timeoutMs: 3 * MINUTE_MS,
            allowedToolNames: ['sessions_spawn'],
            content: primaryPrompt,
          },
          {
            delayBeforeMs: INITIAL_MONITOR_DELAY_MS,
            lifecycleBefore: 'app_relaunch',
            route: 'forced_agentic',
            selectedMode: 'agentic',
            timeoutMs: 24 * MINUTE_MS,
            allowedToolNames: [
              'sessions_spawn',
              'sessions_send',
              'sessions_list',
              'sessions_status',
              'sessions_wait',
              'sessions_output',
            ],
            content: continuationPrompt,
          },
          {
            route: 'forced_agentic',
            selectedMode: 'agentic',
            timeoutMs: 2 * MINUTE_MS,
            allowedToolNames: ['read_file'],
            content: finalReviewPrompt,
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
    const workers = listActiveSubAgents()
      .filter((worker) => worker.parentConversationId === conversationId)
      .sort((left, right) => left.startedAt - right.startedAt);
    const primarySessions = workers.filter(
      (worker) => worker.name === 'architecture-audit-primary',
    );
    const primary = primarySessions[primarySessions.length - 1] ?? null;
    const verifier =
      workers.find((worker) => worker.name === 'architecture-audit-verifier') ?? null;
    const remediator =
      workers.find((worker) => worker.name === 'architecture-audit-remediator') ?? null;
    const primaryDurationMs = primarySessions.reduce(
      (sum, worker) => sum + measureWorkerDurationMs(worker, completedAt),
      0,
    );
    const verifierDurationMs = verifier ? measureWorkerDurationMs(verifier, completedAt) : 0;
    const remediatorDurationMs = remediator ? measureWorkerDurationMs(remediator, completedAt) : 0;
    const activeWorkerDurationMs = primaryDurationMs + verifierDurationMs + remediatorDurationMs;
    const primaryReadCount = primarySessions.reduce(
      (sum, worker) => sum + workerToolCount(toolObservations, worker.sessionId, 'read_file'),
      0,
    );
    const primaryWriteCount = primarySessions.reduce(
      (sum, worker) => sum + workerToolCount(toolObservations, worker.sessionId, 'write_file'),
      0,
    );
    const verifierReadCount = workerToolCount(toolObservations, verifier?.sessionId, 'read_file');
    const verifierWriteCount = workerToolCount(toolObservations, verifier?.sessionId, 'write_file');
    const remediatorReadCount = workerToolCount(
      toolObservations,
      remediator?.sessionId,
      'read_file',
    );
    const remediatorWriteCount = workerToolCount(
      toolObservations,
      remediator?.sessionId,
      'write_file',
    );
    const workerWaitCount = workers.reduce(
      (sum, worker) => sum + workerToolCount(toolObservations, worker.sessionId, 'wait'),
      0,
    );

    const checkpointTexts = CHECKPOINT_PATHS.map(
      (checkpointPath) => readWorkspaceRelativeFile(conversationId, checkpointPath) ?? null,
    );
    const primaryReport = readWorkspaceRelativeFile(conversationId, PRIMARY_REPORT_PATH) ?? null;
    const verifiedReport = readWorkspaceRelativeFile(conversationId, VERIFIED_REPORT_PATH) ?? null;
    const executionPlan = readWorkspaceRelativeFile(conversationId, EXECUTION_PLAN_PATH) ?? null;
    const availableCheckpointTexts = checkpointTexts.filter(
      (text): text is string => text !== null,
    );
    const checkpointCorpus = availableCheckpointTexts.join('\n');
    const checkpointsVerified =
      availableCheckpointTexts.length === CHECKPOINT_PATHS.length &&
      availableCheckpointTexts.every((text) => text.length >= 1_000 && text.length <= 5_000) &&
      Array.from({ length: 15 }, (_, index) =>
        checkpointCorpus.includes(`ARCH_EVIDENCE_${String(index + 1).padStart(2, '0')}`),
      ).every(Boolean);
    const primaryReportVerified =
      primaryReport !== null &&
      primaryReport.length >= 5_000 &&
      primaryReport.length <= 12_000 &&
      primaryReport.includes('PACKETS_REVIEWED: 20') &&
      /DECISION:\s*(GO|CONDITIONAL_GO|HOLD)/u.test(primaryReport) &&
      includesAllEvidenceTokens(primaryReport);
    const verifiedReportVerified =
      verifiedReport !== null &&
      verifiedReport.length >= 5_000 &&
      verifiedReport.length <= 12_000 &&
      verifiedReport.includes('PACKETS_VERIFIED: 20') &&
      /VERIFIED_DECISION:\s*(GO|CONDITIONAL_GO|HOLD)/u.test(verifiedReport) &&
      includesAllEvidenceTokens(verifiedReport);
    const executionPlanVerified =
      executionPlan !== null &&
      executionPlan.length >= 5_000 &&
      executionPlan.length <= 12_000 &&
      executionPlan.includes('REMEDIATION_PLAN: 20') &&
      executionPlan.includes('EXECUTION_ORDER') &&
      includesAllEvidenceTokens(executionPlan);

    const allTurnToolCalls = Array.from(
      new Map(
        (
          driverResult?.turns.flatMap((turn) =>
            turn.messages.flatMap((message) => message.toolCalls ?? []),
          ) ?? []
        ).map((toolCall) => [toolCall.id, toolCall]),
      ).values(),
    );
    const spawnCalls = allTurnToolCalls.filter((toolCall) => toolCall.name === 'sessions_spawn');
    const sendCalls = allTurnToolCalls.filter((toolCall) => toolCall.name === 'sessions_send');
    const supervisorReadCount = workerToolCount(toolObservations, conversationId, 'read_file');
    const supervisorWriteCount = workerToolCount(toolObservations, conversationId, 'write_file');
    const spawnArguments = spawnCalls.map((call) => parseToolArguments(call.arguments));
    const sendArguments = sendCalls.map((call) => parseToolArguments(call.arguments));
    const turnsCompleted =
      driverResult?.turns.length === 3 &&
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
    if (spawnCalls.length !== 3) rubricFailures.push(`spawn_count:${spawnCalls.length}`);
    const primaryRepairCount = Math.max(0, primarySessions.length - 1);
    if (primaryRepairCount > 1) rubricFailures.push(`primary_repair_count:${primaryRepairCount}`);
    if (sendCalls.length !== primaryRepairCount) {
      rubricFailures.push(`continuation_count:${sendCalls.length}:${primaryRepairCount}`);
    }
    if (workers.length !== 3 + primaryRepairCount) {
      rubricFailures.push(`worker_count:${workers.length}`);
    }
    if (primary?.status !== 'completed') rubricFailures.push(`primary_status:${primary?.status}`);
    if (verifier?.status !== 'completed')
      rubricFailures.push(`verifier_status:${verifier?.status}`);
    if (remediator?.status !== 'completed') {
      rubricFailures.push(`remediator_status:${remediator?.status}`);
    }
    const primaryCompletionAcknowledged =
      primary?.output?.includes(PRIMARY_MARKER) ||
      (/all 20 packets (were )?reviewed/iu.test(primary?.output ?? '') &&
        primary?.output?.includes(PRIMARY_REPORT_PATH) &&
        /\b(GO|CONDITIONAL_GO|HOLD)\b/u.test(primary?.output ?? ''));
    const verifierCompletionAcknowledged =
      verifier?.output?.includes(VERIFIER_MARKER) ||
      (/20 packet/iu.test(verifier?.output ?? '') &&
        /verified/iu.test(verifier?.output ?? '') &&
        /\b(GO|CONDITIONAL_GO|HOLD)\b/u.test(verifier?.output ?? ''));
    const remediatorCompletionAcknowledged =
      remediator?.output?.includes(REMEDIATOR_MARKER) ||
      (/remediation plan/iu.test(remediator?.output ?? '') &&
        /\b(GO|CONDITIONAL_GO|HOLD)\b/u.test(remediator?.output ?? ''));
    if (!primaryCompletionAcknowledged) rubricFailures.push('primary_completion_unacknowledged');
    if (!verifierCompletionAcknowledged) {
      rubricFailures.push('verifier_completion_unacknowledged');
    }
    if (!remediatorCompletionAcknowledged) {
      rubricFailures.push('remediator_completion_unacknowledged');
    }
    if (primaryReadCount < PACKET_COUNT || primaryReadCount > PACKET_COUNT + 15) {
      rubricFailures.push(`primary_read_count:${primaryReadCount}`);
    }
    if (primaryWriteCount < 3 || primaryWriteCount > 7) {
      rubricFailures.push(`primary_write_count:${primaryWriteCount}`);
    }
    if (verifierReadCount < 10 || verifierReadCount > 12) {
      rubricFailures.push(`verifier_read_count:${verifierReadCount}`);
    }
    if (verifierWriteCount < 1 || verifierWriteCount > 2) {
      rubricFailures.push(`verifier_write_count:${verifierWriteCount}`);
    }
    if (remediatorReadCount < 5 || remediatorReadCount > 7) {
      rubricFailures.push(`remediator_read_count:${remediatorReadCount}`);
    }
    if (remediatorWriteCount < 1 || remediatorWriteCount > 2) {
      rubricFailures.push(`remediator_write_count:${remediatorWriteCount}`);
    }
    if (workerWaitCount !== 0) rubricFailures.push(`worker_wait_count:${workerWaitCount}`);
    if (watchdogCancelledSessionIds.length > 0 && primaryRepairCount === 0) {
      rubricFailures.push(`watchdog_cancelled:${watchdogCancelledSessionIds.join(',')}`);
    }
    if (!checkpointsVerified) rubricFailures.push('checkpoint_content_not_verified');
    if (!primaryReportVerified) rubricFailures.push('primary_report_not_verified');
    if (!verifiedReportVerified) rubricFailures.push('verified_report_not_verified');
    if (!executionPlanVerified) rubricFailures.push('execution_plan_not_verified');
    if (supervisorReadCount !== 1)
      rubricFailures.push(`supervisor_read_count:${supervisorReadCount}`);
    if (supervisorWriteCount !== 0) {
      rubricFailures.push(`supervisor_write_count:${supervisorWriteCount}`);
    }
    if (primary && verifier && verifier.startedAt < primary.updatedAt) {
      rubricFailures.push('workers_overlapped');
    }
    if (verifier && remediator && remediator.startedAt < verifier.updatedAt) {
      rubricFailures.push('workers_overlapped');
    }
    if (activeWorkerDurationMs < TARGET_MIN_ACTIVE_WORK_MS) {
      rubricFailures.push(`active_work_too_short_ms:${activeWorkerDurationMs}`);
    }
    if (activeWorkerDurationMs > TARGET_MAX_ACTIVE_WORK_MS) {
      rubricFailures.push(`active_work_too_long_ms:${activeWorkerDurationMs}`);
    }
    if (
      primarySessions.length === 0 ||
      !primarySessions.every((worker) =>
        workerSamples.some((sample) => sample.sessionId === worker.sessionId),
      )
    ) {
      rubricFailures.push('primary_not_monitored');
    }
    if (!workerSamples.some((sample) => sample.sessionId === verifier?.sessionId)) {
      rubricFailures.push('verifier_not_monitored');
    }
    if (!workerSamples.some((sample) => sample.sessionId === remediator?.sessionId)) {
      rubricFailures.push('remediator_not_monitored');
    }
    const expectedSpawnNames = [
      'architecture-audit-primary',
      'architecture-audit-verifier',
      'architecture-audit-remediator',
    ];
    for (const [index, args] of spawnArguments.entries()) {
      if (
        !Array.isArray(args?.tools) ||
        args.tools.length !== 2 ||
        !args.tools.includes('read_file') ||
        !args.tools.includes('write_file')
      ) {
        rubricFailures.push(`worker_${index + 1}_tool_scope_invalid`);
      }
      if (args?.name !== expectedSpawnNames[index]) {
        rubricFailures.push(`worker_${index + 1}_name_invalid`);
      }
      if (args?.waitForCompletion !== index > 0) {
        rubricFailures.push(`worker_${index + 1}_wait_mode_invalid`);
      }
    }
    for (const [index, args] of sendArguments.entries()) {
      if (
        args?.waitForCompletion !== true ||
        args.waitTimeoutMs !== MAX_SINGLE_STAGE_MS ||
        typeof args.sessionId !== 'string'
      ) {
        rubricFailures.push(`continuation_${index + 1}_arguments_invalid`);
      }
    }

    const artifactEvidence = (artifactPath: string, content: string | null) =>
      content
        ? {
            path: artifactPath,
            chars: content.length,
            sha256: createHash('sha256').update(content).digest('hex'),
            headerPreview: content.slice(0, 500),
          }
        : null;
    const evidence = {
      schemaVersion: 1,
      runId,
      provider: { family: provider.providerFamily, model: provider.model },
      profile: {
        kind: 'substantive_source_audit',
        packetCount: PACKET_COUNT,
        targetMinActiveWorkMs: TARGET_MIN_ACTIVE_WORK_MS,
        targetMaxActiveWorkMs: TARGET_MAX_ACTIVE_WORK_MS,
        maxSingleStageMs: MAX_SINGLE_STAGE_MS,
        workerWaitToolsAllowed: false,
      },
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startedAt,
      executionError,
      rubric: {
        passed: rubricFailures.length === 0,
        failures: rubricFailures,
        activeWorkerDurationMs,
        primaryDurationMs,
        primaryRepairCount,
        verifierDurationMs,
        remediatorDurationMs,
        primaryReadCount,
        primaryWriteCount,
        verifierReadCount,
        verifierWriteCount,
        remediatorReadCount,
        remediatorWriteCount,
        workerWaitCount,
        supervisorReadCount,
        supervisorWriteCount,
        watchdogCancelledSessionIds,
        availableCheckpointCount: availableCheckpointTexts.length,
        primaryCompletionAcknowledged: Boolean(primaryCompletionAcknowledged),
        verifierCompletionAcknowledged: Boolean(verifierCompletionAcknowledged),
        remediatorCompletionAcknowledged: Boolean(remediatorCompletionAcknowledged),
        checkpointsVerified,
        primaryReportVerified,
        verifiedReportVerified,
        executionPlanVerified,
      },
      chat: {
        turnCount: driverResult?.turns.length ?? 0,
        durationsMs: driverResult?.turns.map((turn) => turn.durationMs) ?? [],
        errors: driverResult?.turns.map((turn) => turn.error) ?? [],
        completions: driverResult?.turns.map((turn) => turn.completion) ?? [],
        lifecycle: driverResult?.turns.map((turn) => turn.lifecycleBefore) ?? [],
        assistants: driverResult?.turns.map((turn) => turn.finalAssistant?.text ?? null) ?? [],
        usage: driverResult?.turns.map((turn) => turn.usage) ?? [],
        runs:
          driverResult?.turns.map((turn) =>
            turn.run
              ? {
                  id: turn.run.id,
                  status: turn.run.status,
                  terminalReason: turn.run.terminalReason ?? null,
                  latestSummary: turn.run.latestSummary ?? null,
                  checkpoints: turn.run.checkpoints.slice(-12),
                  controlGraph: turn.run.controlGraph ?? null,
                }
              : null,
          ) ?? [],
        recentLogs: driverResult?.finalConversation.logs?.slice(-20) ?? [],
        spawnCount: spawnCalls.length,
        spawnArguments,
        continuationCount: sendCalls.length,
        sendArguments,
        toolCalls: allTurnToolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: parseToolArguments(call.arguments),
          status: call.status,
          startedAt: call.startedAt ?? null,
          completedAt: call.completedAt ?? null,
          result: call.result ?? null,
          error: call.error ?? null,
        })),
      },
      workers: {
        primary: primarySessions.map((worker) => summarizeWorker(worker)),
        verifier: summarizeWorker(verifier),
        remediator: summarizeWorker(remediator),
      },
      workerToolTranscripts: {
        primary: primarySessions.map((worker) => summarizeWorkerToolTranscript(worker)),
        verifier: summarizeWorkerToolTranscript(verifier),
        remediator: summarizeWorkerToolTranscript(remediator),
      },
      toolTimeline: toolObservations.map((entry) => ({
        ...entry,
        atIso: new Date(entry.at).toISOString(),
      })),
      progressSamples: workerSamples.map((sample) => ({
        ...sample,
        atIso: new Date(sample.at).toISOString(),
      })),
      artifacts: {
        checkpoints: CHECKPOINT_PATHS.map((checkpointPath, index) =>
          artifactEvidence(checkpointPath, checkpointTexts[index] ?? null),
        ),
        primary: artifactEvidence(PRIMARY_REPORT_PATH, primaryReport),
        verified: artifactEvidence(VERIFIED_REPORT_PATH, verifiedReport),
        executionPlan: artifactEvidence(EXECUTION_PLAN_PATH, executionPlan),
      },
    };
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[actual-work-live] evidence=${evidencePath}`);

    await stopAndResetWorkers();
    expect(rubricFailures).toEqual([]);
  });
});
