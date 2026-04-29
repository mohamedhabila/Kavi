// ---------------------------------------------------------------------------
// Tests — promptAssembly ↔ LlmService cache-marker contract
// ---------------------------------------------------------------------------
// LlmService's internal SystemPromptSection shape is `{ text: string; cacheable?: boolean }`.
// `assemblePrompt()` produces the same shape, and LlmService's
// `splitCacheableSystemPromptSections` collapses that array into
// `{ cacheableText, dynamicText }` for provider-native cache emission:
//   • Anthropic: `cache_control: {type:'ephemeral'}` on the last cacheable system block
//   • OpenAI:    `prompt_cache_key` on the request body (relies on stable prefix)
//   • Gemini:    `cachedContent` handle ensured from cacheableText
// This test verifies the boundary: whatever assemblePrompt emits remains
// splittable into a stable cacheable prefix + a per-turn dynamic tail.
// If anyone ever changes the field names or ordering, this test fails fast.

import {
  assemblePrompt,
  type SystemPromptSection,
} from '../../src/services/memory/promptAssembly';

// Structural mirror of LlmService's private splitter — kept tiny on purpose.
function splitCacheable(sections: SystemPromptSection[]): {
  cacheableText: string;
  dynamicText: string;
} {
  const cacheable = sections.filter((s) => s.cacheable).map((s) => s.text);
  const dynamic = sections.filter((s) => !s.cacheable).map((s) => s.text);
  return {
    cacheableText: cacheable.join('\n\n'),
    dynamicText: dynamic.join('\n\n'),
  };
}

describe('promptAssembly ↔ LlmService contract', () => {
  const baseInput = {
    basePrompt: 'You are Kavi, the user assistant.',
    blocks: [
      {
        id: 'b-profile',
        label: 'profile',
        description: 'User facts',
        content: 'Name: Alice. Timezone: America/Los_Angeles.',
        charLimit: 800,
        pinned: 1 as const,
        readOnly: 0 as const,
        updatedAt: 1,
        updatedBy: 'consolidator' as const,
      },
    ],
    focusBlock: 'picking up the conversation',
    retrievedFacts: [],
  };

  it('all cacheable sections come strictly before non-cacheable sections', () => {
    const { sections } = assemblePrompt(baseInput);
    const lastCacheable = sections.findLastIndex((s) => s.cacheable);
    const firstDynamic = sections.findIndex((s) => !s.cacheable);
    if (firstDynamic !== -1 && lastCacheable !== -1) {
      expect(lastCacheable).toBeLessThan(firstDynamic);
    }
  });

  it('every section has a string text field (LlmService contract)', () => {
    const { sections } = assemblePrompt(baseInput);
    for (const section of sections) {
      expect(typeof section.text).toBe('string');
      expect(section.text.length).toBeGreaterThan(0);
    }
  });

  it('split mirrors LlmService.splitCacheableSystemPromptSections shape', () => {
    const { sections } = assemblePrompt(baseInput);
    const split = splitCacheable(sections);
    expect(split.cacheableText).toContain('You are Kavi');
    expect(split.cacheableText).toContain('Name: Alice');
    expect(split.dynamicText).toContain('picking up the conversation');
  });

  it('cacheable prefix is byte-stable across changes to dynamic addenda', () => {
    const a = assemblePrompt(baseInput);
    const b = assemblePrompt({
      ...baseInput,
      focusBlock: 'back after a short break (~12m)',
    });
    expect(a.cacheableSignature).toBe(b.cacheableSignature);
    expect(splitCacheable(a.sections).cacheableText).toBe(
      splitCacheable(b.sections).cacheableText,
    );
  });

  it('changing a cacheable layer rotates the cacheable signature', () => {
    const a = assemblePrompt(baseInput);
    const b = assemblePrompt({
      ...baseInput,
      basePrompt: 'You are Kavi v2.',
    });
    expect(a.cacheableSignature).not.toBe(b.cacheableSignature);
  });
});
