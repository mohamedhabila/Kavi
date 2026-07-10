import { chmodSync, mkdirSync, realpathSync } from 'fs';
import { randomUUID } from 'crypto';
import { join, relative, resolve, sep } from 'path';

import { atomicWriteFileSync } from '../../../scripts/e2eReport/fileTransaction';
import type { E2EScenario, E2EScenarioResult, E2EScenarioTurnTrace } from './types';

export const E2E_PRIVATE_EVIDENCE_DIR_ENV = 'E2E_PRIVATE_EVIDENCE_DIR';
export const E2E_PRIVATE_EVIDENCE_SCHEMA_VERSION = 'e2e-private-scenario-evidence-v1';

export type E2EPrivateScenarioEvidence = {
  schemaVersion: typeof E2E_PRIVATE_EVIDENCE_SCHEMA_VERSION;
  evidenceId: string;
  capturedAt: string;
  scenario: {
    id: string;
    contentClass: E2EScenario['contentClass'];
    execution: E2EScenario['execution'];
    requestedTurns: ReadonlyArray<{ text: string; route: E2EScenario['execution']['route'] }>;
    rubrics: E2EScenario['rubrics'];
  };
  result: {
    fixtureId: string;
    conversationId: string;
    contentClass: E2EScenarioResult['contentClass'];
    completed: boolean;
    durationMs: number;
    userTurnCount: number;
    errors: E2EScenarioResult['errors'];
    usage: E2EScenarioResult['usage'];
    memoryFinalState: E2EScenarioResult['memoryFinalState'];
    turns: ReadonlyArray<{
      turnIndex: number;
      user: E2EScenarioTurnTrace['user'];
      route: E2EScenarioTurnTrace['route'];
      finalAssistant: E2EScenarioTurnTrace['finalAssistant'];
      finalAssistantCandidateCount: number;
      completion: E2EScenarioTurnTrace['completion'];
      agentRun: E2EScenarioTurnTrace['agentRun'];
      memory: E2EScenarioTurnTrace['memory'];
      memoryEvidence: E2EScenarioTurnTrace['memoryEvidence'];
      native: E2EScenarioTurnTrace['native'];
      toolCalls: E2EScenarioTurnTrace['toolCalls'];
      toolResults: E2EScenarioTurnTrace['toolResults'];
      graphSnapshots: E2EScenarioTurnTrace['graphSnapshots'];
      usage: E2EScenarioTurnTrace['usage'];
      completed: boolean;
    }>;
  };
};

function requestedTurns(
  scenario: E2EScenario,
): E2EPrivateScenarioEvidence['scenario']['requestedTurns'] {
  const turns = scenario.userTurns?.length ? scenario.userTurns : [{ content: scenario.prompt }];
  return turns.map((turn) => ({
    text: turn.content,
    route: turn.route ?? scenario.execution.route,
  }));
}

function projectTurn(
  turn: E2EScenarioTurnTrace,
): E2EPrivateScenarioEvidence['result']['turns'][number] {
  return {
    turnIndex: turn.turnIndex,
    user: turn.user,
    route: turn.route,
    finalAssistant: turn.finalAssistant,
    finalAssistantCandidateCount: turn.finalAssistantCandidateCount,
    completion: turn.completion,
    agentRun: turn.agentRun,
    memory: turn.memory,
    memoryEvidence: turn.memoryEvidence,
    native: turn.native,
    toolCalls: turn.toolCalls,
    toolResults: turn.toolResults,
    graphSnapshots: turn.graphSnapshots,
    usage: turn.usage,
    completed: turn.completed,
  };
}

export function buildE2EPrivateScenarioEvidence(params: {
  scenario: E2EScenario;
  result: E2EScenarioResult;
  evidenceId?: string;
  now?: Date;
}): E2EPrivateScenarioEvidence {
  if (params.scenario.id !== params.result.fixtureId) {
    throw new Error('Private evidence scenario id does not match the result fixture id.');
  }
  if (params.scenario.contentClass !== params.result.contentClass) {
    throw new Error('Private evidence content classification does not match the result.');
  }
  const evidenceId = params.evidenceId ?? randomUUID();
  if (!/^[a-zA-Z0-9._-]+$/u.test(evidenceId)) {
    throw new Error('Private evidence id contains unsafe characters.');
  }
  return {
    schemaVersion: E2E_PRIVATE_EVIDENCE_SCHEMA_VERSION,
    evidenceId,
    capturedAt: (params.now ?? new Date()).toISOString(),
    scenario: {
      id: params.scenario.id,
      contentClass: params.scenario.contentClass,
      execution: { ...params.scenario.execution },
      requestedTurns: requestedTurns(params.scenario),
      rubrics: JSON.parse(JSON.stringify(params.scenario.rubrics)) as E2EScenario['rubrics'],
    },
    result: {
      fixtureId: params.result.fixtureId,
      conversationId: params.result.conversationId,
      contentClass: params.result.contentClass,
      completed: params.result.completed,
      durationMs: params.result.durationMs,
      userTurnCount: params.result.userTurnCount,
      errors: [...params.result.errors],
      usage: params.result.usage,
      memoryFinalState: params.result.memoryFinalState,
      turns: params.result.turnTraces.map(projectTurn),
    },
  };
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function resolvePrivateEvidenceDirectory(cwd: string, configuredPath: string): string {
  const privateRoot = resolve(cwd, '.private', 'evals');
  const requested = resolve(cwd, configuredPath);
  if (!isWithin(privateRoot, requested)) {
    throw new Error(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} must resolve inside .private/evals.`);
  }
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  mkdirSync(requested, { recursive: true, mode: 0o700 });
  const realRoot = realpathSync(privateRoot);
  const realRequested = realpathSync(requested);
  if (!isWithin(realRoot, realRequested)) {
    throw new Error(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} must not escape .private/evals via symlink.`);
  }
  return realRequested;
}

function safeScenarioId(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return safe || 'scenario';
}

export function writeE2EPrivateScenarioEvidence(params: {
  scenario: E2EScenario;
  result: E2EScenarioResult;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  evidenceId?: string;
  now?: Date;
}): string | null {
  const configuredPath = (params.env ?? process.env)[E2E_PRIVATE_EVIDENCE_DIR_ENV]?.trim();
  if (!configuredPath) return null;
  const cwd = resolve(params.cwd ?? process.cwd());
  const outputDir = resolvePrivateEvidenceDirectory(cwd, configuredPath);
  const evidence = buildE2EPrivateScenarioEvidence(params);
  const outputPath = join(
    outputDir,
    `${safeScenarioId(params.scenario.id)}-${evidence.evidenceId}.json`,
  );
  if (relative(outputDir, outputPath).startsWith('..')) {
    throw new Error('Private evidence output escaped its configured directory.');
  }
  atomicWriteFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
  chmodSync(outputPath, 0o600);
  return outputPath;
}
