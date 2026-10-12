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
