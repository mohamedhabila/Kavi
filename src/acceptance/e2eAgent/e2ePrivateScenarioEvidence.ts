import { chmodSync, existsSync, mkdirSync, realpathSync } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join, relative, resolve, sep } from 'path';

import { atomicWriteFileSync } from '../../../scripts/e2eReport/fileTransaction';
import type { E2EScenario, E2EScenarioResult, E2EScenarioTurnTrace } from './types';

export const E2E_PRIVATE_EVIDENCE_DIR_ENV = 'E2E_PRIVATE_EVIDENCE_DIR';
export const E2E_PRIVATE_EVIDENCE_SCHEMA_VERSION = 'e2e-private-scenario-evidence-v5';

export type E2EPrivateScenarioEvidence = {
  schemaVersion: typeof E2E_PRIVATE_EVIDENCE_SCHEMA_VERSION;
  evidenceId: string;
  capturedAt: string;
  scenario: {
    id: string;
    contentClass: E2EScenario['contentClass'];
    execution: E2EScenario['execution'];
    requestedTurns: ReadonlyArray<{
      text: string;
      route: E2EScenario['execution']['route'];
      lifecycleBefore: NonNullable<
        NonNullable<E2EScenario['userTurns']>[number]['lifecycleBefore']
      > | null;
      selectedMode: E2EScenario['execution']['initialMode'] | null;
    }>;
    rubrics: E2EScenario['rubrics'];
    pairedEvaluation: E2EScenario['pairedEvaluation'] | null;
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
    estimatedCost: E2EScenarioResult['estimatedCost'];
    memoryFinalState: E2EScenarioResult['memoryFinalState'];
    turns: ReadonlyArray<{
      turnIndex: number;
      lifecycleBefore: E2EScenarioTurnTrace['lifecycleBefore'];
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
    lifecycleBefore: turn.lifecycleBefore ?? null,
    selectedMode: turn.selectedMode ?? null,
  }));
}

function projectTurn(
  turn: E2EScenarioTurnTrace,
): E2EPrivateScenarioEvidence['result']['turns'][number] {
  if (turn.lifecycleBefore === undefined) {
    throw new Error('Private evidence turn lifecycleBefore is missing.');
  }
  return {
    turnIndex: turn.turnIndex,
    lifecycleBefore: turn.lifecycleBefore,
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
      pairedEvaluation: params.scenario.pairedEvaluation
        ? JSON.parse(JSON.stringify(params.scenario.pairedEvaluation))
        : null,
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
      estimatedCost: params.result.estimatedCost,
      memoryFinalState: params.result.memoryFinalState,
      turns: params.result.turnTraces.map(projectTurn),
    },
  };
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function resolvePrivateEvidenceDirectory(cwd: string, configuredPath: string): string {
  const realCwd = realpathSync(cwd);
  const privateParent = resolve(cwd, '.private');
  const privateRoot = resolve(cwd, '.private', 'evals');
  const requested = resolve(cwd, configuredPath);
  if (!isWithin(privateRoot, requested)) {
    throw new Error(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} must resolve inside .private/evals.`);
  }

  mkdirSync(privateParent, { recursive: true, mode: 0o700 });
  if (realpathSync(privateParent) !== resolve(realCwd, '.private')) {
    throw new Error(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} private root must not be a symlink.`);
  }
  chmodSync(realpathSync(privateParent), 0o700);
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const realRoot = realpathSync(privateRoot);
  if (realRoot !== resolve(realCwd, '.private', 'evals')) {
    throw new Error(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} private root must not be a symlink.`);
  }

  let existingAncestor = requested;
  while (!existsSync(existingAncestor)) existingAncestor = dirname(existingAncestor);
  if (!isWithin(realRoot, realpathSync(existingAncestor))) {
    throw new Error(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} must not escape .private/evals via symlink.`);
  }
  mkdirSync(requested, { recursive: true, mode: 0o700 });
  const realRequested = realpathSync(requested);
  if (!isWithin(realRoot, realRequested)) {
    throw new Error(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} must not escape .private/evals via symlink.`);
  }
  chmodSync(realRoot, 0o700);
  chmodSync(realRequested, 0o700);
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
  if (existsSync(outputPath)) {
    throw new Error('Private evidence id already exists in the configured directory.');
  }
  atomicWriteFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
  chmodSync(outputPath, 0o600);
  return outputPath;
}
