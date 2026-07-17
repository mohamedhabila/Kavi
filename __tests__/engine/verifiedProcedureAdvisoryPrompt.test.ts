import { estimateTokens } from '../../src/services/context/tokenCounter';
import type { VerifiedProcedureExecutionSession } from '../../src/services/memory/verifiedProcedure/executionSession';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { PreparedAgentTurn } from '../../src/engine/graph/agentTurnPreparation';
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  appendVerifiedProcedureAdvisoryPrompt,
  VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS,
} from '../../src/engine/graph/modelTurn/verifiedProcedureAdvisoryPrompt';
import { buildMemoryPromptDispatchGuard } from '../../src/engine/graph/modelTurn/memoryPromptDispatchFence';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

const mockProjectionCurrent = jest.fn(() => true);
const mockRestrictiveCurrent = jest.fn(() => true);
jest.mock('../../src/services/memory/verifiedProcedure/observationAuthority', () => ({
  isVerifiedProcedureAuthoritySnapshotShape: () => true,
  isVerifiedProcedureProjectionSnapshotDurablyCurrent: (...args: unknown[]) =>
    mockProjectionCurrent(...args),
  isRestrictiveVerifiedProcedureAuthorityProcessEpochCurrent: (...args: unknown[]) =>
    mockRestrictiveCurrent(...args),
  isVerifiedProcedureRestrictiveAuthorityRevisionDurablyCurrent: (...args: unknown[]) =>
    mockRestrictiveCurrent(...args),
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
    enrichedSystemPromptSections: [
      { text: 'Base system prompt', cacheable: true, purpose: 'base_prompt' },
    ],
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
      validUntil: Number.MAX_SAFE_INTEGER,
      authoritySnapshot: {
        processEpochs: { restrictive: 0, projection: 0 },
        restrictiveRevision: { kind: 'restrictive', memoryOwnerId: 'test-owner', value: 1 },
        projectionRevision: { kind: 'projection', memoryOwnerId: 'test-owner', value: 1 },
      },
    }),
  } as unknown as VerifiedProcedureExecutionSession;
}

beforeEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  mockProjectionCurrent.mockReturnValue(true);
  mockRestrictiveCurrent.mockReturnValue(true);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  jest.restoreAllMocks();
});

describe('verified procedure advisory prompt', () => {
  it('adds bounded non-cacheable advisory evidence without changing the tool surface', async () => {
    const { readEpoch } = captureCurrentModelTurnMemoryFence();
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
      purpose: 'verified_procedure',
    });
    expect(estimateTokens(section)).toBeLessThanOrEqual(VERIFIED_PROCEDURE_ADVISORY_MAX_TOKENS);
    expect(result.memoryReadFence?.memoryAuthoritySnapshot).toBeDefined();
  });

  it('does not add an advisory when the execution has no applicable verified procedure', async () => {
    const unavailable = {
      buildApplicableAdvisory: jest.fn().mockResolvedValue(null),
    } as unknown as VerifiedProcedureExecutionSession;
    const base = preparedTurn();

    await expect(appendVerifiedProcedureAdvisoryPrompt(base, unavailable)).resolves.toBe(base);
  });

  it('fences delayed dispatch with the original procedure-free prompt', async () => {
    const { readEpoch } = captureCurrentModelTurnMemoryFence();
    const result = await appendVerifiedProcedureAdvisoryPrompt(
      preparedTurn(),
      session('Verified advisory', readEpoch),
    );
    const guard = buildMemoryPromptDispatchGuard(result);

    useSettingsStore.setState({ disableLongTermMemory: true } as never);

    expect(() => guard?.()).toThrow('memory_prompt_epoch_expired');
  });

  it('keeps admitted dispatch current when an additive projection arrives', async () => {
    const { readEpoch } = captureCurrentModelTurnMemoryFence();
    const result = await appendVerifiedProcedureAdvisoryPrompt(
      preparedTurn(),
      session('Verified advisory', readEpoch),
    );
    const guard = buildMemoryPromptDispatchGuard(result);

    mockProjectionCurrent.mockReturnValue(false);

    expect(() => guard?.()).not.toThrow();
  });

  it('fences dispatch when targeted invalidation advances restrictive authority', async () => {
    const { readEpoch } = captureCurrentModelTurnMemoryFence();
    const result = await appendVerifiedProcedureAdvisoryPrompt(
      preparedTurn(),
      session('Verified advisory', readEpoch),
    );
    const guard = buildMemoryPromptDispatchGuard(result);

    mockRestrictiveCurrent.mockReturnValue(false);

    expect(() => guard?.()).toThrow('memory_prompt_epoch_expired');
  });

  it('keeps living memory immutable and lets the session rebuild after revocation', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    const { readEpoch } = memoryFence;
    const base = preparedTurn();
    const withLivingMemory: PreparedAgentTurn = {
      ...base,
      enrichedSystemPrompt: 'Base system prompt\n\nPRIVATE LIVING MEMORY',
      enrichedSystemPromptSections: [
        ...base.enrichedSystemPromptSections,
        { text: 'PRIVATE LIVING MEMORY', purpose: 'living_memory' },
      ],
      memoryReadFence: {
        ...memoryFence,
      },
    };

    const result = await appendVerifiedProcedureAdvisoryPrompt(
      withLivingMemory,
      session('Verified advisory', readEpoch),
    );
    expect(result.enrichedSystemPrompt).toContain('PRIVATE LIVING MEMORY');
    expect(result.enrichedSystemPrompt).toContain('Verified advisory');
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    expect(() => buildMemoryPromptDispatchGuard(result)?.()).toThrow('memory_prompt_epoch_expired');
  });
});
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
