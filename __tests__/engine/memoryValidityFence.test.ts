jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  assertModelTurnMemoryPolicyBindingCurrent,
  buildDurableModelEffectAuthority,
  buildModelTurnMemoryPolicyBinding,
  isMemoryPromptEpochExpiredError,
  isModelTurnMemoryPolicyBindingCurrent,
  isModelTurnMemoryPolicyBindingDurablyCurrent,
  MemoryPromptEpochExpiredError,
  serializeDurableModelEffectAuthority,
} from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { resolveLivingMemoryValidUntil } from '../../src/services/memory/livingMemoryBridge';
import { closeMemoryDb } from '../../src/services/memory/database';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';

const sqliteMock = jest.requireMock('expo-sqlite') as {
  __resetExpoSqliteForTests(): void;
};

beforeEach(() => {
  closeMemoryDb();
  sqliteMock.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false });
  closeMemoryDb();
});

describe('time-driven memory validity fence', () => {
  it('uses the earliest expiry across prompt-visible facts', () => {
    expect(
      resolveLivingMemoryValidUntil({
        facts: [{ expiresAt: 900 }, { expiresAt: 700 }, { expiresAt: null }],
        episodeSelections: [],
        now: 500,
      }),
    ).toBe(700);
  });

  it('preserves episode-policy expiry as an equally authoritative deadline', () => {
    expect(
      resolveLivingMemoryValidUntil({
        facts: [{ expiresAt: 900 }],
        episodeSelections: [{ policyExpiresAt: 650 }, { policyExpiresAt: null }],
        now: 500,
      }),
    ).toBe(650);
  });

  it('omits the deadline only when every projected memory is non-expiring', () => {
    expect(
      resolveLivingMemoryValidUntil({
        facts: [{ expiresAt: null }],
        episodeSelections: [{ policyExpiresAt: null }],
        now: 500,
      }),
    ).toBeUndefined();
  });

  it('rejects an expiry exactly at the projection boundary', () => {
    expect(() =>
      resolveLivingMemoryValidUntil({
        facts: [{ expiresAt: 500 }],
        episodeSelections: [],
        now: 500,
      }),
    ).toThrow('memory_validity_deadline_invalid');
  });

  it('expires local and durable turn authority at exact deadline equality', () => {
    const binding = buildModelTurnMemoryPolicyBinding({
      ...captureCurrentModelTurnMemoryFence(),
      validUntil: 700,
    });

    expect(isModelTurnMemoryPolicyBindingCurrent(binding, 699)).toBe(true);
    expect(isModelTurnMemoryPolicyBindingDurablyCurrent(binding, 699)).toBe(true);
    expect(isModelTurnMemoryPolicyBindingCurrent(binding, 700)).toBe(false);
    expect(isModelTurnMemoryPolicyBindingDurablyCurrent(binding, 700)).toBe(false);
    expect(() => assertModelTurnMemoryPolicyBindingCurrent(binding, 700)).toThrow(
      'memory_prompt_epoch_expired',
    );
  });

  it('closes durable serialization over the exact deadline', () => {
    const fence = captureCurrentModelTurnMemoryFence();
    const before = buildDurableModelEffectAuthority(
      buildModelTurnMemoryPolicyBinding({ ...fence, validUntil: 700 }),
    );
    const after = buildDurableModelEffectAuthority(
      buildModelTurnMemoryPolicyBinding({ ...fence, validUntil: 701 }),
    );

    expect(before).toMatchObject({ kind: 'memory_epoch', validUntil: 700 });
    expect(serializeDurableModelEffectAuthority(before)).not.toBe(
      serializeDurableModelEffectAuthority(after),
    );
  });

  it('classifies expiry by typed identity rather than diagnostic text', () => {
    expect(isMemoryPromptEpochExpiredError(new MemoryPromptEpochExpiredError())).toBe(true);
    expect(isMemoryPromptEpochExpiredError(new Error('memory_prompt_epoch_expired'))).toBe(false);
  });
});
