jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import { buildE2EProvider } from '../../src/acceptance/e2eAgent/providerConfig';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { finalizeProviderConfig } from '../../src/constants/api';
import { LlmService } from '../../src/services/llm/LlmService';

const describeLivePilot =
  process.env.RUN_STRUCTURED_SOURCE_MEMORY_PILOT === '1' ? describe : describe.skip;

const REVIEW_MARKER = 'quartz-ember-482';
const SOURCE_TEXT = [
  'Preserve this entire project brief as one exact source for later conversations. Do not reduce it to a few preference facts.',
  '',
  'Aurora field trial — operating brief',
  'Owner: Field Operations',
  'Objective: compare two low-power sensor layouts during a three-day coastal trial.',
  'Day 1: inventory arrives at Dock 4; photograph every sealed case before opening it.',
  'Day 2: team Cedar calibrates the northern array; team Sable checks the southern relay.',
  'Day 3: collect the final readings before equipment leaves the observation zone.',
  'Weather hold rule: pause deployment when visibility is below the recorded safety threshold.',
  'Data rule: preserve raw readings; corrections belong in a separate annotated file.',
  'Handoff owner: Morgan Ibarra.',
  'Review marker: quartz-ember-482.',
  'Review location: the blue meeting room beside the equipment desk.',
  'Decision log: the spare relay remains packed unless either primary relay misses two check-ins.',
  'Closeout: reconcile the case inventory and record unresolved discrepancies without guessing.',
].join('\n');

function preservedSourceContent(objectText: string): string | null {
  try {
    const parsed = JSON.parse(objectText) as Record<string, unknown>;
    return parsed.version === 1 && typeof parsed.content === 'string' ? parsed.content : null;
  } catch {
    return null;
  }
}

describeLivePilot('structured source memory — exact foreground chat', () => {
  jest.setTimeout(6 * 60 * 1_000);

  afterAll(() => {
    teardownE2EMemorySandbox();
  });

  it('preserves exact bounded source text for query-grounded recall in a fresh conversation', async () => {
    resetE2EMemorySandbox();
    const configuredProvider = buildE2EProvider();
    const discoveredModels = await new LlmService(configuredProvider).fetchModels();
    const provider = finalizeProviderConfig({
      ...configuredProvider,
      availableModels:
        discoveredModels.models.length > 0
          ? discoveredModels.models
          : configuredProvider.availableModels,
      modelCapabilities: {
        ...(configuredProvider.modelCapabilities ?? {}),
        ...discoveredModels.capabilities,
      },
    });

    const result = await runForegroundScenario({
      provider,
      conversationId: `structured-source-memory-${Date.now()}`,
      conversationTitle: 'Aurora field trial source',
      systemPrompt:
        'You are a careful general mobile assistant. Preserve user-authorized memory exactly, respect scope, and ground later answers in retrieved evidence.',
      defaultMode: 'chitchat',
      scenarioTimeoutMs: 5 * 60 * 1_000,
      timeoutMs: 2 * 60 * 1_000,
      maxTokens: 4_096,
      enableCompaction: true,
      turns: [
        {
          content: SOURCE_TEXT,
          route: 'production_auto',
          selectedMode: 'chitchat',
        },
        {
          lifecycleBefore: 'new_conversation',
          content:
            'From the Aurora field trial brief I asked you to preserve, what is the review marker? Reply with only the marker.',
          route: 'production_auto',
          selectedMode: 'chitchat',
        },
      ],
    });

    const toolCalls = result.turns.flatMap((turn) =>
      turn.messages.flatMap((message) => message.toolCalls ?? []),
    );
    const preserveCallIds = new Set(
      toolCalls.filter((call) => call.name === 'memory_preserve_source').map((call) => call.id),
    );
    const sourceFacts = result.memoryFinalState.facts.filter(
      (fact) => fact.memoryKind === 'source' && fact.deletedAt === null,
    );
    const sourceContent = sourceFacts[0] ? preservedSourceContent(sourceFacts[0].objectText) : null;
    const retrievedFactIds = new Set(
      result.turns[1]?.retrieval.events.flatMap((event) => event.counts.selectedFactIds) ?? [],
    );
    const diagnostic = JSON.stringify({
      provider: { family: provider.providerFamily, model: provider.model },
      completions: result.turns.map((turn) => turn.completion),
      assistants: result.turns.map((turn) => turn.finalAssistant?.text ?? null),
      toolCalls: toolCalls.map((call) => ({
        name: call.name,
        arguments: call.arguments,
        status: call.status,
        result: call.result,
        error: call.error,
        effectReceipts: call.effectReceipts,
      })),
      sourceFacts: sourceFacts.map((fact) => ({
        id: fact.id,
        scope: fact.scope,
        sourceMessageId: fact.sourceMessageId,
        objectText: fact.objectText,
        sensitivity: fact.sensitivity,
      })),
      retrieval: result.turns[1]?.retrieval,
    });

    if (
      result.turns.length !== 2 ||
      result.turns.some(
        (turn) =>
          turn.completion.executionCompleted !== true ||
          turn.completion.finalResponseCompleted !== true,
      ) ||
      preserveCallIds.size !== 1 ||
      sourceFacts.length !== 1 ||
      sourceFacts[0]?.scope !== 'global' ||
      sourceContent !== SOURCE_TEXT ||
      !retrievedFactIds.has(sourceFacts[0].id) ||
      result.turns[1]?.finalAssistant?.text.trim() !== REVIEW_MARKER
    ) {
      throw new Error(`structured_source_memory_live_pilot_failed: ${diagnostic}`);
    }
  });
});
