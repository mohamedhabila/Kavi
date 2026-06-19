import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS } from '../../src/acceptance/e2eAgent/thresholds';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
} from '../helpers/e2eRunReportHarness';

describe('e2eRunReport cache eligibility', () => {
  installE2ERunReportFixtureReset();

  it('reports cache readiness from eligible input instead of any cache hit', () => {
    const usage = {
      inputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
      outputTokens: 10,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      totalTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS + 10,
      eventCount: 1,
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
      cacheTelemetry: {
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.cache.eligibleInputTokens).toBe(E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS);
    expect(report.cache.cacheReadTokens).toBe(100);
    expect(report.cache.passing).toBe(false);
    expect(report.cache.cacheCreateTelemetryAvailable).toBe(true);
    expect(report.metricsPassing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('cache_readiness');
    expect(report.readiness.failedCriteria).not.toContain('cache_create_telemetry');
  });

  it('uses provider prompt-cache telemetry instead of aggregate scenario input for eligibility', () => {
    const usage = {
      inputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS * 2,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS * 2 + 10,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 0,
        enabledTurnCount: 0,
        skippedTurnCount: 2,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 0,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: [],
        reasonCounts: [{ reason: 'below_threshold', count: 2 }],
        events: [
          {
            eligible: false,
            enabled: false,
            estimatedInputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS - 200,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'skip',
            reason: 'below_threshold',
          },
          {
            eligible: false,
            enabled: false,
            estimatedInputTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS - 100,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'skip',
            reason: 'below_threshold',
          },
        ],
      },
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
      cacheTelemetry: {
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(entry.cache.eligibleInputTokens).toBe(0);
    expect(report.cache.eligibleInputTokens).toBe(0);
    expect(report.cache.passing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('cache_readiness');
  });

  it('caps telemetry-estimated eligible input at actual provider input tokens', () => {
    const usage = {
      inputTokens: 4096,
      outputTokens: 10,
      cacheReadTokens: 2048,
      cacheWriteTokens: 0,
      totalTokens: 4106,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 2,
        enabledTurnCount: 2,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 2,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: [],
        reasonCounts: [{ reason: 'gemini_implicit_cache', count: 2 }],
        events: [
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
          },
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'gemini',
            hostedFamily: 'gemini',
            mode: 'gemini_native',
            event: 'provider_managed',
            reason: 'gemini_implicit_cache',
          },
        ],
      },
    };
    const result = buildFixtureResult({ usage });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
    });

    expect(entry.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.eligibleCacheReadRate).toBe(0.5);
  });

  it('counts provider-managed cache reuse across turn traces from scenario telemetry', () => {
    const firstEvent = {
      eligible: true,
      enabled: true,
      estimatedInputTokens: 4096,
      thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
      providerFamily: 'openai',
      hostedFamily: 'openai',
      mode: 'openai_native' as const,
      event: 'provider_managed' as const,
      reason: 'automatic_prompt_cache',
      explicitCacheName: 'cm:openai-cross-turn',
      stableSystemPromptDigest: 'system-prompt:stable',
      stableToolDeclarationDigest: 'tools:stable',
      cacheablePrefixDigest: 'prompt-prefix:stable',
      toolDeclarationDigest: 'tools:stable',
      prefixDivergenceReason: 'fully_stable_prefix' as const,
    };
    const secondEvent = {
      ...firstEvent,
      estimatedInputTokens: 4096,
    };
    const usage = {
      inputTokens: 8192,
      outputTokens: 10,
      cacheReadTokens: 2048,
      cacheWriteTokens: 0,
      totalTokens: 8202,
      eventCount: 2,
      promptCache: {
        eligibleTurnCount: 2,
        enabledTurnCount: 2,
        skippedTurnCount: 0,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 2,
        thresholdTokens: [E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS],
        explicitCacheNames: ['cm:openai-cross-turn'],
        reasonCounts: [{ reason: 'automatic_prompt_cache', count: 2 }],
        events: [firstEvent, secondEvent],
      },
    };
    const result = buildFixtureResult({
      usage,
      turnTraces: [
        {
          turnIndex: 0,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          completed: true,
          usage: {
            ...usage,
            inputTokens: 4096,
            outputTokens: 5,
            cacheReadTokens: 0,
            totalTokens: 4101,
            eventCount: 1,
            promptCache: {
              ...usage.promptCache,
              eligibleTurnCount: 1,
              enabledTurnCount: 1,
              providerManagedEventCount: 1,
              events: [firstEvent],
            },
          },
        },
        {
          turnIndex: 1,
          toolCalls: [],
          toolResults: [],
          graphSnapshots: [],
          completed: true,
          usage: {
            ...usage,
            inputTokens: 4096,
            outputTokens: 5,
            cacheReadTokens: 2048,
            totalTokens: 4101,
            eventCount: 1,
            promptCache: {
              ...usage.promptCache,
              eligibleTurnCount: 1,
              enabledTurnCount: 1,
              providerManagedEventCount: 1,
              events: [secondEvent],
            },
          },
        },
      ],
    });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: 'file-write-read', passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: 'file-write-read', passed: true }],
      metricResults: [result],
    });

    expect(entry.cache.eligibleInputTokens).toBe(4096);
    expect(entry.cache.providerManagedReadinessTokens).toBe(4096);
    expect(entry.cache.eligibleCacheReadRate).toBe(0.5);
    expect(report.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.providerManagedReadinessTokens).toBe(4096);
    expect(report.cache.eligibleCacheReadRate).toBe(0.5);
  });
});
