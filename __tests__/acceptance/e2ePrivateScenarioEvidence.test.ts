import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildE2EPrivateScenarioEvidence,
  E2E_PRIVATE_EVIDENCE_DIR_ENV,
  E2E_PRIVATE_EVIDENCE_SCHEMA_VERSION,
  writeE2EPrivateScenarioEvidence,
} from '../../src/acceptance/e2eAgent/e2ePrivateScenarioEvidence';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  resetE2ENativeMobileFixtures,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import type { E2EScenario, E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';

const SCENARIO: E2EScenario = {
  id: 'private-evidence-scenario',
  conversationId: 'private-evidence-conversation',
  contentClass: 'private',
  execution: { initialMode: 'agentic', route: 'production_auto' },
  prompt: 'PRIVATE-REQUEST-SENTINEL',
  rubrics: [
    {
      kind: 'memory_fact',
      subject: 'private-subject',
      predicate: 'private_key',
      value: 'PRIVATE-RUBRIC-SENTINEL',
      scope: 'global',
    },
  ],
};

function buildPrivateResult(): E2EScenarioResult {
  resetE2ENativeMobileFixtures();
  const nativeState = getE2ENativeMobileFixtureStateSnapshot();
  const usage = buildFixtureResult().usage;
  return buildFixtureResult({
    contentClass: 'private',
    fixtureId: SCENARIO.id,
    conversationId: SCENARIO.conversationId,
    estimatedCost: { status: 'available', usd: 0.125 },
    memoryFinalState: {
      capturedAt: 10,
      scope: {
        memoryConversationId: SCENARIO.conversationId,
        sourceThreadId: SCENARIO.conversationId,
      },
      facts: [],
      episodes: [],
      workingBlocks: [
        {
          id: 'active_focus:private',
          label: 'active_focus',
          scopeKey: 'private',
          conversationId: SCENARIO.conversationId,
          threadId: SCENARIO.conversationId,
          taskId: null,
          content: 'PRIVATE-MEMORY-SENTINEL',
          updatedAt: 10,
        },
      ],
      ingestionJobs: [],
    },
    turnTraces: [
      {
        turnIndex: 0,
        lifecycleBefore: null,
        user: {
          messageId: 'private-user-message',
          text: 'PRIVATE-USER-SENTINEL',
          timestamp: 1,
        },
        route: {
          directive: 'production_auto',
          mode: 'agentic',
          personaId: 'private-custom-persona',
        },
        finalAssistant: {
          messageId: 'private-assistant-message',
          text: 'PRIVATE-FINAL-SENTINEL',
          timestamp: 2,
          completionStatus: 'complete',
          finishReason: 'stop',
          terminalReason: null,
        },
        finalAssistantCandidateCount: 1,
        completion: {
          assistantStatus: 'complete',
          executionCompleted: true,
          finalResponseCompleted: true,
          runStatus: 'completed',
          runCompleted: true,
          runCompletedAt: 2,
          runTerminalReason: null,
          graphStatus: 'finalized',
          graphTerminalReason: null,
        },
        agentRun: null,
        memory: [],
        memoryEvidence: {
          delta: {
            capturedAt: 10,
            facts: { createdIds: [], updatedIds: [], removedIds: [] },
            episodes: { createdIds: [], updatedIds: [], removedIds: [] },
            workingBlocks: { createdIds: [], updatedIds: [], removedIds: [] },
            ingestionJobs: { createdIds: [], updatedIds: [], removedIds: [] },
            invalidatedFactIds: [],
            deletedFactIds: [],
            deletedEpisodeIds: [],
            clearedWorkingBlockIds: [],
            completedIngestionJobIds: [],
          },
        },
        native: { stateBefore: nativeState, stateAfter: nativeState, invocations: [] },
        toolCalls: [
          { id: 'private-tool-call', name: 'write_file', arguments: 'PRIVATE-ARGS-SENTINEL' },
        ],
        toolResults: [
          {
            toolCallId: 'private-tool-call',
            name: 'write_file',
            content: 'PRIVATE-RESULT-SENTINEL',
            isError: false,
          },
        ],
        graphSnapshots: [],
        usage,
        completed: true,
      },
    ],
  });
}

describe('private E2E scenario evidence', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'kavi-private-evidence-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('builds a closed raw evidence DTO without serializing Message/provider replay objects', () => {
    const evidence = buildE2EPrivateScenarioEvidence({
      scenario: SCENARIO,
      result: buildPrivateResult(),
      evidenceId: 'evidence-1',
      now: new Date('2026-07-10T00:00:00.000Z'),
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence.schemaVersion).toBe(E2E_PRIVATE_EVIDENCE_SCHEMA_VERSION);
    expect(evidence.scenario.requestedTurns).toEqual([
      {
        text: 'PRIVATE-REQUEST-SENTINEL',
        route: 'production_auto',
        lifecycleBefore: null,
        selectedMode: null,
      },
    ]);
    expect(evidence.result.turns[0]?.lifecycleBefore).toBeNull();
    expect(evidence.result.estimatedCost).toEqual({ status: 'available', usd: 0.125 });
    for (const sentinel of [
      'PRIVATE-REQUEST-SENTINEL',
      'PRIVATE-USER-SENTINEL',
      'PRIVATE-FINAL-SENTINEL',
      'PRIVATE-MEMORY-SENTINEL',
      'PRIVATE-ARGS-SENTINEL',
      'PRIVATE-RESULT-SENTINEL',
      'PRIVATE-RUBRIC-SENTINEL',
    ]) {
      expect(serialized).toContain(sentinel);
    }
    expect(serialized).not.toContain('providerReplay');
    expect(serialized).not.toContain('initialMessages');
  });

  it('preserves a verified relaunch boundary in requested and observed private evidence', () => {
    const lifecycleBefore = {
      boundary: 'app_relaunch' as const,
      chatStore: 'rehydrated' as const,
      memoryStore: 'reopened' as const,
    };
    const result = buildPrivateResult();
    const evidence = buildE2EPrivateScenarioEvidence({
      scenario: {
        ...SCENARIO,
        userTurns: [
          {
            content: 'PRIVATE-REQUEST-SENTINEL',
            route: 'forced_chitchat',
            lifecycleBefore: 'app_relaunch',
            selectedMode: 'chitchat',
          },
        ],
      },
      result: {
        ...result,
        turnTraces: [{ ...result.turnTraces[0]!, lifecycleBefore }],
      },
    });

    expect(evidence.scenario.requestedTurns[0]).toMatchObject({
      lifecycleBefore: 'app_relaunch',
      selectedMode: 'chitchat',
    });
    expect(evidence.result.turns[0]?.lifecycleBefore).toEqual(lifecycleBefore);
  });

  it('writes unique owner-only artifacts only inside the configured private root', () => {
    const configuredDir = join(cwd, '.private', 'evals', 'run-a');
    const env = { [E2E_PRIVATE_EVIDENCE_DIR_ENV]: configuredDir };
    const result = buildPrivateResult();
    const firstPath = writeE2EPrivateScenarioEvidence({
      scenario: SCENARIO,
      result,
      env,
      cwd,
      evidenceId: 'attempt-1',
    });
    const secondPath = writeE2EPrivateScenarioEvidence({
      scenario: SCENARIO,
      result,
      env,
      cwd,
      evidenceId: 'attempt-2',
    });

    expect(firstPath).not.toBe(secondPath);
    expect(readdirSync(configuredDir)).toHaveLength(2);
    expect(statSync(join(cwd, '.private', 'evals')).mode & 0o777).toBe(0o700);
    expect(statSync(configuredDir).mode & 0o777).toBe(0o700);
    expect(statSync(firstPath!).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(firstPath!, 'utf8'))).toMatchObject({
      evidenceId: 'attempt-1',
      result: { contentClass: 'private' },
    });
    expect(() =>
      writeE2EPrivateScenarioEvidence({
        scenario: SCENARIO,
        result,
        env,
        cwd,
        evidenceId: 'attempt-1',
      }),
    ).toThrow('Private evidence id already exists');
  });

  it('does not write when unconfigured and rejects paths outside .private/evals', () => {
    const result = buildPrivateResult();
    expect(
      writeE2EPrivateScenarioEvidence({ scenario: SCENARIO, result, env: {}, cwd }),
    ).toBeNull();
    expect(() =>
      writeE2EPrivateScenarioEvidence({
        scenario: SCENARIO,
        result,
        env: { [E2E_PRIVATE_EVIDENCE_DIR_ENV]: join(cwd, 'outside') },
        cwd,
      }),
    ).toThrow(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} must resolve inside .private/evals.`);
  });

  it('rejects a configured directory that escapes through a symlink', () => {
    const result = buildPrivateResult();
    const privateRoot = join(cwd, '.private', 'evals');
    const outside = join(cwd, 'outside');
    mkdirSync(privateRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const linked = join(privateRoot, 'linked');
    symlinkSync(outside, linked, 'dir');

    expect(() =>
      writeE2EPrivateScenarioEvidence({
        scenario: SCENARIO,
        result,
        env: { [E2E_PRIVATE_EVIDENCE_DIR_ENV]: linked },
        cwd,
      }),
    ).toThrow(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} must not escape .private/evals via symlink.`);
  });

  it('rejects a symlinked private root', () => {
    const result = buildPrivateResult();
    const outside = join(cwd, 'outside');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(cwd, '.private'), 'dir');

    expect(() =>
      writeE2EPrivateScenarioEvidence({
        scenario: SCENARIO,
        result,
        env: { [E2E_PRIVATE_EVIDENCE_DIR_ENV]: join(cwd, '.private', 'evals') },
        cwd,
      }),
    ).toThrow(`${E2E_PRIVATE_EVIDENCE_DIR_ENV} private root must not be a symlink.`);
  });

  it('rejects mismatched scenario identity and classification', () => {
    const result = buildPrivateResult();
    expect(() =>
      buildE2EPrivateScenarioEvidence({
        scenario: { ...SCENARIO, id: 'different' },
        result,
      }),
    ).toThrow('Private evidence scenario id does not match');
    expect(() =>
      buildE2EPrivateScenarioEvidence({
        scenario: { ...SCENARIO, contentClass: 'synthetic_public' },
        result,
      }),
    ).toThrow('Private evidence content classification does not match');
  });
});
