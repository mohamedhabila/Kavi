import { getE2ENativeMobileFixtureStateSnapshot } from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import type { ForegroundScenarioMemoryPromptEvidence } from '../../src/acceptance/e2eAgent/foregroundScenarioMemoryItemsEvidence';
import type { E2EScenarioTurnTrace } from '../../src/acceptance/e2eAgent/types';
import { buildFixtureResult } from './e2eRunReportHarness';

export type PairedMemoryPromptBuild = ForegroundScenarioMemoryPromptEvidence['builds'][number];

/** One memory section build that selected one saved memory and one past exchange. */
export function buildPairedMemoryPromptBuild(
  overrides: Partial<PairedMemoryPromptBuild> = {},
): PairedMemoryPromptBuild {
  return {
    itemIds: ['private-item-id'],
    turnIds: ['private-past-turn-id'],
    chars: 400,
    durationMs: 1,
    ...overrides,
  };
}

/** A turn whose memory reads were recorded, by default one build that selected memory. */
export function recordedMemoryPrompt(
  builds: ReadonlyArray<PairedMemoryPromptBuild> = [buildPairedMemoryPromptBuild()],
): ForegroundScenarioMemoryPromptEvidence {
  return { status: 'recorded', builds };
}

/** A turn run with memory off. */
export const OPTED_OUT_MEMORY_PROMPT: ForegroundScenarioMemoryPromptEvidence = {
  status: 'opt_out',
  builds: [],
};

export function buildPairedTurnTrace(
  memoryPrompt: ForegroundScenarioMemoryPromptEvidence,
  overrides: Readonly<{
    route?: Pick<E2EScenarioTurnTrace['route'], 'directive' | 'mode'>;
    turnIndex?: number;
  }> = {},
): E2EScenarioTurnTrace {
  const nativeState = getE2ENativeMobileFixtureStateSnapshot();
  return {
    turnIndex: overrides.turnIndex ?? 0,
    lifecycleBefore: null,
    user: { messageId: 'user-1', text: 'test prompt', timestamp: 1 },
    route: {
      ...(overrides.route ?? { directive: 'production_auto', mode: 'chitchat' }),
      personaId: 'default',
    },
    finalAssistant: {
      messageId: 'assistant-1',
      text: 'test response',
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
      runStatus: 'not_applicable',
      runCompleted: null,
      runCompletedAt: null,
      runTerminalReason: null,
      graphStatus: null,
      graphTerminalReason: null,
    },
    agentRun: null,
    memoryExtractionSettled: true,
    memoryExtractionWaitMs: 0,
    native: { stateBefore: nativeState, stateAfter: nativeState, invocations: [] },
    memoryPrompt,
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    usage: buildFixtureResult().usage,
    completed: true,
  };
}
