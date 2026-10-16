import { readFileSync } from 'fs';
import { join } from 'path';

import {
  LOCAL_LLM_CRITICAL_CONTEXT_TOKENS,
  LOCAL_LLM_HOT_MAX_TOKENS,
  limitLocalLlmForHeat,
  parseLocalLlmThermalState,
} from '../../../src/services/localLlm/thermalPolicy';
import type { LocalLlmExecutionPolicy } from '../../../src/services/localLlm/types';

const POLICY = {
  modelId: 'gemma-4-E2B-it',
  modelName: 'Gemma 4 E2B',
  runtime: 'litert-lm',
  maxTokens: 4_000,
  recommendedMaxTokens: 4_000,
  maxContextLength: 32_000,
  safeMaxContextWindowTokens: 12_288,
  topK: 64,
  topP: 0.95,
  temperature: 1,
  minDeviceMemoryGb: 8,
} as LocalLlmExecutionPolicy;

describe('limitLocalLlmForHeat', () => {
  it('asks a cool phone for everything the model allows', () => {
    expect(limitLocalLlmForHeat(POLICY, 'nominal')).toBe(POLICY);
    expect(limitLocalLlmForHeat(POLICY, 'fair')).toBe(POLICY);
    expect(limitLocalLlmForHeat(POLICY, null)).toBe(POLICY);
  });

  it('keeps replies shorter on a seriously hot phone', () => {
    expect(limitLocalLlmForHeat(POLICY, 'serious')).toEqual({
      ...POLICY,
      maxTokens: LOCAL_LLM_HOT_MAX_TOKENS.serious,
    });
  });

  it('cuts both the reply and the context on a critically hot phone, but still answers', () => {
    expect(limitLocalLlmForHeat(POLICY, 'critical')).toEqual({
      ...POLICY,
      maxTokens: LOCAL_LLM_HOT_MAX_TOKENS.critical,
      safeMaxContextWindowTokens: LOCAL_LLM_CRITICAL_CONTEXT_TOKENS,
    });
  });

  it('never raises a budget that was already lower', () => {
    const small = { ...POLICY, maxTokens: 256, safeMaxContextWindowTokens: 2_048 };

    expect(limitLocalLlmForHeat(small, 'critical')).toBe(small);
  });

  it('reads only the four states the native runtimes report', () => {
    expect(parseLocalLlmThermalState('serious')).toBe('serious');
    expect(parseLocalLlmThermalState('hot')).toBeNull();
    expect(parseLocalLlmThermalState(undefined)).toBeNull();
  });

  it('is fed by both native runtimes', () => {
    const root = join(__dirname, '../../..');
    const android = readFileSync(
      join(root, 'android/app/src/main/java/com/kavi/app/localllm/LocalLlmDeviceInfo.kt'),
      'utf8',
    );
    const ios = readFileSync(join(root, 'ios/Kavi/LocalLlm/LocalLlmDeviceInfo.swift'), 'utf8');

    expect(android).toContain('putString("thermalState", thermalState)');
    expect(android).toContain('PowerManager.THERMAL_STATUS_SEVERE -> "serious"');
    expect(ios).toContain('"thermalState": thermalState ?? NSNull()');
    expect(ios).toContain('ProcessInfo.processInfo.thermalState');
  });
});
