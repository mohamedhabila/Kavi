import { aggregateE2ETokenUsage } from '../../src/acceptance/e2eAgent/tokenUsage';
import type { TokenUsage } from '../../src/types/usage';

describe('aggregateE2ETokenUsage', () => {
  it('aggregates structural token buckets and prompt-cache telemetry', () => {
    const events: TokenUsage[] = [
      {
        model: 'gpt-5.4',
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
        totalTokens: 110,
        tokenBuckets: {
          systemPromptTokens: 1,
          toolDeclarationTokens: 2,
          memoryContextTokens: 3,
          conversationHistoryTokens: 4,
          userTurnTokens: 5,
          toolResultTokens: 6,
        },
        promptCache: {
          eligible: true,
          enabled: true,
          estimatedInputTokens: 1200,
          thresholdTokens: 1024,
          providerFamily: 'openai',
          hostedFamily: 'openai',
          mode: 'openai_native',
          event: 'provider_managed',
          reason: 'automatic_prompt_cache',
          explicitCacheName: 'cm:test',
          stableSystemPromptDigest: 'system:a',
          stableToolDeclarationDigest: 'stable-tools:a',
          cacheablePrefixDigest: 'prompt-prefix:a',
          toolDeclarationDigest: 'tools:a',
        },
      },
      {
        model: 'gpt-5.4',
        inputTokens: 50,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 55,
        tokenBuckets: {
          systemPromptTokens: 10,
          toolDeclarationTokens: 20,
          memoryContextTokens: 30,
          conversationHistoryTokens: 40,
          userTurnTokens: 50,
          toolResultTokens: 60,
        },
        promptCache: {
          eligible: false,
          enabled: false,
          estimatedInputTokens: 512,
          thresholdTokens: 1024,
          providerFamily: 'openai',
          hostedFamily: 'openai',
          mode: 'openai_native',
          event: 'skip',
          reason: 'below_threshold',
          stableSystemPromptDigest: 'system:a',
          stableToolDeclarationDigest: 'stable-tools:a',
          cacheablePrefixDigest: 'prompt-prefix:a',
          toolDeclarationDigest: 'tools:b',
        },
      },
    ];

    expect(aggregateE2ETokenUsage(events)).toMatchObject({
      inputTokens: 150,
      outputTokens: 15,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      totalTokens: 165,
      eventCount: 2,
      tokenBuckets: {
        systemPromptTokens: 11,
        toolDeclarationTokens: 22,
        memoryContextTokens: 33,
        conversationHistoryTokens: 44,
        userTurnTokens: 55,
        toolResultTokens: 66,
      },
      promptCache: {
        eligibleTurnCount: 1,
        enabledTurnCount: 1,
        skippedTurnCount: 1,
        createEventCount: 0,
        reuseEventCount: 0,
        providerManagedEventCount: 1,
        thresholdTokens: [1024],
        explicitCacheNames: ['cm:test'],
        reasonCounts: [
          { reason: 'automatic_prompt_cache', count: 1 },
          { reason: 'below_threshold', count: 1 },
        ],
        prefixStability: {
          eventCount: 2,
          uniqueStableSystemPromptDigestCount: 1,
          uniqueStableToolDeclarationDigestCount: 1,
          uniqueCacheablePrefixDigestCount: 1,
          uniqueToolDeclarationDigestCount: 2,
          longestStableSystemPromptRun: 2,
          longestStableToolDeclarationRun: 2,
          longestCacheablePrefixRun: 2,
          longestToolDeclarationRun: 1,
        },
      },
    });
  });
});
