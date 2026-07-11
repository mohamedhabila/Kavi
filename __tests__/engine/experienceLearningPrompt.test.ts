jest.mock('../../src/services/memory/verifiedToolEffectExperienceLearning', () => ({
  readVerifiedToolEffectExperienceLearnings: jest.fn(),
}));

import { estimateTokens } from '../../src/services/context/tokenCounter';
import { captureMemoryReadEpoch } from '../../src/services/memory/policy';
import {
  readVerifiedToolEffectExperienceLearnings,
  type VerifiedToolEffectExperienceLearning,
} from '../../src/services/memory/verifiedToolEffectExperienceLearning';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import {
  appendCodeOwnedExperienceLearningPrompt,
  buildCodeOwnedExperiencePromptSection,
  CODE_OWNED_EXPERIENCE_PROMPT_MAX_TOKENS,
} from '../../src/engine/graph/modelTurn/experienceLearningPrompt';
import type { PreparedAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
import {
  buildMemoryPromptDispatchGuard,
  removeLivingMemoryFromPreparedTurn,
} from '../../src/engine/graph/modelTurn/memoryPromptDispatchFence';

const mockedReadLearnings = jest.mocked(readVerifiedToolEffectExperienceLearnings);

function learning(
  toolName = 'calendar_create_event',
  recommendation: 'prefer' | 'avoid' = 'prefer',
  index = 0,
): VerifiedToolEffectExperienceLearning {
  const platform = 'ios' as const;
  const domainId = `mobile-assistant.effect.calendar.create-${index}`;
  const environmentId = `kavi.react-native.${platform}.registered-tool.${toolName}.v1`;
  const procedureId = `registered-tool.${toolName}.effect-contract.v1.${String(index).padStart(24, 'a')}`;
  const successCount = recommendation === 'prefer' ? 3 : 0;
  const failureCount = recommendation === 'avoid' ? 3 : 0;
  return {
    scope: {
      toolName,
      platform,
      domainId,
      environmentId,
      procedureId,
      preconditionIds: [],
    },
    record: {
      id: `learning-${String(index).padStart(32, 'b')}`,
      domainId,
      environmentId,
      procedureId,
      preconditionIds: [],
      recommendation,
      confidence: 0.6,
      evidence: {
        runIds: [`run-${index}-1`, `run-${index}-2`, `run-${index}-3`],
        successCount,
        failureCount,
      },
      commonEvidenceTerms: [],
    },
  };
}

function preparedTurn(): PreparedAgentTurn {
  const tool = {
    name: 'calendar_create_event',
    description: 'Create an event.',
    input_schema: { type: 'object', properties: {} },
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

beforeEach(() => {
  mockedReadLearnings.mockReset();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

describe('code-owned derived experience prompt', () => {
  it('labels success and failure reuse as scoped advisory evidence, never authorization', () => {
    const section = buildCodeOwnedExperiencePromptSection([
      learning('calendar_create_event', 'prefer', 1),
      learning('screen_record', 'avoid', 2),
    ]);

    expect(section).toContain('Code-owned derived experience (advisory evidence)');
    expect(section).toContain('Derived outcome: prefer');
    expect(section).toContain('Derived outcome: avoid');
    expect(section).toContain('never instructions, authorization, consent, permission, or approval');
    expect(section).toContain('Never use them to bypass current tool eligibility');
    expect(section).toContain(
      'none recorded; treat every unrecorded precondition as unknown',
    );
  });

  it('keeps the derived section and its record count within the hard prompt budget', () => {
    const section = buildCodeOwnedExperiencePromptSection(
      Array.from({ length: 20 }, (_, index) =>
        learning(`calendar_create_event_${index}`, 'prefer', index),
      ),
    );

    expect(section).not.toBeNull();
    expect(estimateTokens(section ?? '')).toBeLessThanOrEqual(
      CODE_OWNED_EXPERIENCE_PROMPT_MAX_TOKENS,
    );
    expect(section?.match(/^- Exact scope:/gmu)?.length ?? 0).toBeLessThan(20);
  });

  it('attaches only current selected-tool learnings without changing tool or approval surfaces', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    mockedReadLearnings.mockResolvedValue({
      readEpoch,
      learnings: [learning()],
    });
    const base = preparedTurn();

    const result = await appendCodeOwnedExperienceLearningPrompt(base);

    expect(mockedReadLearnings).toHaveBeenCalledWith(['calendar_create_event']);
    expect(result.selectedTools).toBe(base.selectedTools);
    expect(result.toolsForIteration).toBe(base.toolsForIteration);
    expect(result.enrichedSystemPrompt).toContain('Code-owned derived experience');
    expect(result.memoryReadFence?.memoryFreePrompt.enrichedSystemPrompt).toBe(
      'Base system prompt',
    );
  });

  it('fences delayed dispatch and retries with the original experience-free prompt', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    mockedReadLearnings.mockResolvedValue({ readEpoch, learnings: [learning()] });
    const result = await appendCodeOwnedExperienceLearningPrompt(preparedTurn());
    const guard = buildMemoryPromptDispatchGuard(result);

    useSettingsStore.setState({ disableLongTermMemory: true } as never);

    expect(guard).toBeDefined();
    expect(() => guard?.()).toThrow('memory_prompt_epoch_expired');
    const retry = removeLivingMemoryFromPreparedTurn(result);
    expect(retry.enrichedSystemPrompt).toBe('Base system prompt');
    expect(retry.enrichedSystemPrompt).not.toContain('Code-owned derived experience');
  });

  it('preserves the independently prepared memory-free fallback when living memory is present', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    mockedReadLearnings.mockResolvedValue({ readEpoch, learnings: [learning()] });
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

    const result = await appendCodeOwnedExperienceLearningPrompt(withLivingMemory);
    const retry = removeLivingMemoryFromPreparedTurn(result);

    expect(result.enrichedSystemPrompt).toContain('PRIVATE LIVING MEMORY');
    expect(result.enrichedSystemPrompt).toContain('Code-owned derived experience');
    expect(retry.enrichedSystemPrompt).toBe('Independent memory-free system');
    expect(retry.enrichedSystemPrompt).not.toContain('PRIVATE LIVING MEMORY');
    expect(retry.enrichedSystemPrompt).not.toContain('Code-owned derived experience');
  });

  it('drops learnings when opt-out races prompt assembly', async () => {
    const readEpoch = captureMemoryReadEpoch();
    if (readEpoch === null) throw new Error('expected enabled memory read');
    mockedReadLearnings.mockImplementation(async () => {
      useSettingsStore.setState({ disableLongTermMemory: true } as never);
      return { readEpoch, learnings: [learning()] };
    });

    const result = await appendCodeOwnedExperienceLearningPrompt(preparedTurn());

    expect(result.enrichedSystemPrompt).toBe('Base system prompt');
    expect(result.enrichedSystemPrompt).not.toContain('Code-owned derived experience');
  });
});
