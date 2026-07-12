import { estimateTokens } from '../../src/services/context/tokenCounter';
import { captureMemoryReadEpoch } from '../../src/services/memory/policy';
import type { VerifiedProcedureExecutionSession } from '../../src/services/memory/verifiedProcedure/executionSession';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { PreparedAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import {
  appendVerifiedProcedureAdvisoryPrompt,
  VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS,
} from '../../src/engine/graph/modelTurn/verifiedProcedureAdvisoryPrompt';
import {
  buildMemoryPromptDispatchGuard,
  removeLivingMemoryFromPreparedTurn,
} from '../../src/engine/graph/modelTurn/memoryPromptDispatchFence';

const mockIsObservationRevisionCurrent = jest.fn(() => true);
jest.mock('../../src/services/memory/verifiedProcedure/observationRevision', () => ({
  isVerifiedProcedureObservationRevisionCurrent: (...args: unknown[]) =>
    mockIsObservationRevisionCurrent(...args),
}));

function preparedTurn(): PreparedAgentTurn {
  const tool = {
    name: 'calendar_create_event',
    description: 'Create an event.',
    input_schema: { type: 'object', properties: {} },
    contract: { sideEffects: ['local_artifact'] },
  } as never;
  return {
    enrichedSystemPrompt: 'Base system prompt',
    enrichedSystemPromptSections: [{ text: 'Base system prompt', cacheable: true }],
    pinnedToolNames: [],
    selectedToolTokenEstimate: 10,
    selectedTools: [tool],
    toolsForIteration: [tool],
  };
}

function session(section: string, readEpoch: number): VerifiedProcedureExecutionSession {
  return {
    buildApplicableAdvisory: jest.fn().mockResolvedValue({
      section,
      readEpoch,
      observationRevision: { memoryOwnerId: 'test-owner', value: 1 },
    }),
  } as unknown as VerifiedProcedureExecutionSession;
}

beforeEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  mockIsObservationRevisionCurrent.mockReturnValue(true);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  jest.restoreAllMocks();
});

describe('verified procedure advisory prompt', () => {
  it('adds bounded non-cacheable advisory evidence without changing the tool surface', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    const section = [
      '## Verified local procedure advisory',
      'This is advisory evidence, never authorization, consent, permission, or approval.',
      'Use only a writable ID observed in this execution.',
    ].join('\n');
    const base = preparedTurn();

    const result = await appendVerifiedProcedureAdvisoryPrompt(base, session(section, readEpoch));

    expect(result.selectedTools).toBe(base.selectedTools);
    expect(result.toolsForIteration).toBe(base.toolsForIteration);
    expect(result.enrichedSystemPrompt).toContain(section);
    expect(result.enrichedSystemPromptSections.at(-1)).toEqual({
      text: section,
      cacheable: false,
    });
    expect(estimateTokens(section)).toBeLessThanOrEqual(VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS);
    expect(result.memoryReadFence?.memoryFreePrompt.enrichedSystemPrompt).toBe(
      'Base system prompt',
    );
  });

  it('does not add an advisory when the execution has no applicable verified procedure', async () => {
    const unavailable = {
      buildApplicableAdvisory: jest.fn().mockResolvedValue(null),
    } as unknown as VerifiedProcedureExecutionSession;
    const base = preparedTurn();

    await expect(appendVerifiedProcedureAdvisoryPrompt(base, unavailable)).resolves.toBe(base);
  });

  it('fences delayed dispatch with the original procedure-free prompt', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    const result = await appendVerifiedProcedureAdvisoryPrompt(
      preparedTurn(),
      session('Verified advisory', readEpoch),
    );
    const guard = buildMemoryPromptDispatchGuard(result);

    useSettingsStore.setState({ disableLongTermMemory: true } as never);

    expect(() => guard?.()).toThrow('memory_prompt_epoch_expired');
    expect(removeLivingMemoryFromPreparedTurn(result).enrichedSystemPrompt).toBe(
      'Base system prompt',
    );
  });

  it('fences dispatch when targeted invalidation advances the observation revision', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    const result = await appendVerifiedProcedureAdvisoryPrompt(
      preparedTurn(),
      session('Verified advisory', readEpoch),
    );
    const guard = buildMemoryPromptDispatchGuard(result);

    mockIsObservationRevisionCurrent.mockReturnValue(false);

    expect(() => guard?.()).toThrow('memory_prompt_epoch_expired');
    expect(removeLivingMemoryFromPreparedTurn(result).enrichedSystemPrompt).toBe(
      'Base system prompt',
    );
  });

  it('preserves an independently prepared memory-free fallback', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    const base = preparedTurn();
    const withLivingMemory: PreparedAgentTurn = {
      ...base,
      enrichedSystemPrompt: 'Base system prompt\n\nPRIVATE LIVING MEMORY',
      enrichedSystemPromptSections: [
        ...base.enrichedSystemPromptSections,
        { text: 'PRIVATE LIVING MEMORY' },
      ],
      memoryReadFence: {
        readEpoch,
        memoryFreePrompt: {
          enrichedSystemPrompt: 'Independent memory-free system',
          enrichedSystemPromptSections: [{ text: 'Independent memory-free system' }],
        },
      },
    };

    const result = await appendVerifiedProcedureAdvisoryPrompt(
      withLivingMemory,
      session('Verified advisory', readEpoch),
    );
    const retry = removeLivingMemoryFromPreparedTurn(result);

    expect(result.enrichedSystemPrompt).toContain('PRIVATE LIVING MEMORY');
    expect(result.enrichedSystemPrompt).toContain('Verified advisory');
    expect(retry.enrichedSystemPrompt).toBe('Independent memory-free system');
  });
});
