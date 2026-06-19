import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS } from '../../src/acceptance/e2eAgent/thresholds';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
  TOKEN_BUCKETS,
} from '../helpers/e2eRunReportHarness';

describe('e2eRunReport cache telemetry', () => {
  installE2ERunReportFixtureReset();

  it('caps eligible cache read rate at eligible input tokens', () => {
    const usage = {
      inputTokens: 4096,
      outputTokens: 10,
      cacheReadTokens: 8192,
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
        reasonCounts: [{ reason: 'automatic_prompt_cache', count: 2 }],
        events: [
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'openai',
            hostedFamily: 'openai',
            mode: 'openai_native',
            event: 'provider_managed',
            reason: 'automatic_prompt_cache',
          },
          {
            eligible: true,
            enabled: true,
            estimatedInputTokens: 4096,
            thresholdTokens: E2E_PROMPT_CACHE_ELIGIBLE_INPUT_TOKENS,
            providerFamily: 'openai',
            hostedFamily: 'openai',
            mode: 'openai_native',
            event: 'provider_managed',
            reason: 'automatic_prompt_cache',
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

    expect(report.cache.cacheReadTokens).toBe(8192);
    expect(report.cache.eligibleInputTokens).toBe(4096);
    expect(report.cache.eligibleCacheReadRate).toBe(1);
    expect(entry.cache.eligibleCacheReadRate).toBe(1);
  });

  it('passes cache readiness for repeated provider-managed opportunities without real reads', () => {
    const usage = {
      inputTokens: 8192,
      outputTokens: 10,
      cacheReadTokens: 0,
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
            stableSystemPromptDigest: 'system-prompt:test',
            stableToolDeclarationDigest: 'tools:stable',
            cacheablePrefixDigest: 'prompt-prefix:test',
            toolDeclarationDigest: 'tools:test',
            prefixDivergenceReason: 'stable_prefix_with_dynamic_suffix',
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
            stableSystemPromptDigest: 'system-prompt:test',
            stableToolDeclarationDigest: 'tools:stable',
            cacheablePrefixDigest: 'prompt-prefix:test',
            toolDeclarationDigest: 'tools:test',
            prefixDivergenceReason: 'stable_prefix_with_dynamic_suffix',
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

    expect(report.cache.cacheReadTokens).toBe(0);
    expect(report.cache.eligibleCacheReadRate).toBe(0);
    expect(report.cache.providerManagedReadinessTokens).toBe(4096);
    expect(report.cache.providerManagedReadinessObserved).toBe(true);
    expect(report.cache.passing).toBe(false);
    expect(report.readiness.failedCriteria).toContain('cache_readiness');
  });

  it('counts repeated provider-managed opportunities by stable prefix even when all tools are dynamic suffixes', () => {
    const usage = {
      inputTokens: 8192,
      outputTokens: 10,
      cacheReadTokens: 0,
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
            stableSystemPromptDigest: 'system-prompt:stable',
            stableToolDeclarationDigest: 'tools:empty-stable',
            cacheablePrefixDigest: 'prompt-prefix:stable',
            toolDeclarationDigest: 'tools:dynamic-a',
            prefixDivergenceReason: 'no_stable_tool_prefix',
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
            stableSystemPromptDigest: 'system-prompt:stable',
            stableToolDeclarationDigest: 'tools:empty-stable',
            cacheablePrefixDigest: 'prompt-prefix:stable',
            toolDeclarationDigest: 'tools:dynamic-b',
            prefixDivergenceReason: 'no_stable_tool_prefix',
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

    expect(report.cache.providerManagedReadinessTokens).toBe(4096);
    expect(report.cache.promptCacheTelemetry.prefixStability).toMatchObject({
      uniqueStableSystemPromptDigestCount: 1,
      uniqueStableToolDeclarationDigestCount: 1,
      uniqueCacheablePrefixDigestCount: 1,
      uniqueToolDeclarationDigestCount: 2,
      longestStableSystemPromptRun: 2,
      longestStableToolDeclarationRun: 2,
      longestCacheablePrefixRun: 2,
      longestToolDeclarationRun: 1,
    });
  });

  it('aggregates prompt cache telemetry and token buckets into the cache report', () => {
    const result = buildFixtureResult({
      usage: {
        inputTokens: 4096,
        outputTokens: 20,
        cacheReadTokens: 1024,
        cacheWriteTokens: 0,
        totalTokens: 4116,
        eventCount: 2,
        tokenBuckets: TOKEN_BUCKETS,
        promptCache: {
          eligibleTurnCount: 2,
          enabledTurnCount: 2,
          skippedTurnCount: 0,
          createEventCount: 1,
          reuseEventCount: 1,
          providerManagedEventCount: 0,
          thresholdTokens: [4096],
          explicitCacheNames: ['projects/test/cachedContents/1'],
          reasonCounts: [
            { reason: 'gemini_created', count: 1 },
            { reason: 'gemini_memory_cache_entry', count: 1 },
          ],
          events: [
            {
              eligible: true,
              enabled: true,
              estimatedInputTokens: 5000,
              thresholdTokens: 4096,
              providerFamily: 'gemini',
              hostedFamily: 'gemini',
              mode: 'gemini_native',
              event: 'create',
              reason: 'gemini_created',
              explicitCacheName: 'projects/test/cachedContents/1',
              stableSystemPromptDigest: 'system-prompt:test-a',
              stableToolDeclarationDigest: 'stable-tools:test-a',
              cacheablePrefixDigest: 'prompt-prefix:test-a',
              toolDeclarationDigest: 'tools:test-a',
            },
            {
              eligible: true,
              enabled: true,
              estimatedInputTokens: 5000,
              thresholdTokens: 4096,
              providerFamily: 'gemini',
              hostedFamily: 'gemini',
              mode: 'gemini_native',
              event: 'reuse',
              reason: 'gemini_memory_cache_entry',
              explicitCacheName: 'projects/test/cachedContents/1',
              stableSystemPromptDigest: 'system-prompt:test-a',
              stableToolDeclarationDigest: 'stable-tools:test-a',
              cacheablePrefixDigest: 'prompt-prefix:test-a',
              toolDeclarationDigest: 'tools:test-b',
            },
          ],
        },
      },
    });
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: result.fixtureId, passed: true }],
      metricResults: [result],
      cacheTelemetry: {
        cacheCreateAttempts: 1,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    expect(report.cache.promptCacheTelemetry).toMatchObject({
      eligibleTurnCount: 2,
      enabledTurnCount: 2,
      skippedTurnCount: 0,
      createEventCount: 1,
      reuseEventCount: 1,
      providerManagedEventCount: 0,
      thresholdTokens: [4096],
      explicitCacheNameCount: 1,
      reasonCounts: [
        { reason: 'gemini_created', count: 1 },
        { reason: 'gemini_memory_cache_entry', count: 1 },
      ],
      prefixStability: {
        eventCount: 2,
        stableSystemPromptDigestEventCount: 2,
        stableToolDeclarationDigestEventCount: 2,
        cacheablePrefixDigestEventCount: 2,
        toolDeclarationDigestEventCount: 2,
        uniqueStableSystemPromptDigestCount: 1,
        uniqueStableToolDeclarationDigestCount: 1,
        uniqueCacheablePrefixDigestCount: 1,
        uniqueToolDeclarationDigestCount: 2,
        longestStableSystemPromptRun: 2,
        longestStableToolDeclarationRun: 2,
        longestCacheablePrefixRun: 2,
        longestToolDeclarationRun: 1,
      },
    });
    expect(report.cache.scenarios[0]).toMatchObject({
      fixtureId: 'file-write-read',
      tokenBuckets: TOKEN_BUCKETS,
      promptCache: {
        eligibleTurnCount: 2,
        createEventCount: 1,
        reuseEventCount: 1,
      },
    });
  });
});
