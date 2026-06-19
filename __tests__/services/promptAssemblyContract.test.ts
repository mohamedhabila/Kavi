// ---------------------------------------------------------------------------
// Tests — promptAssembly ↔ LlmService cache-marker contract
// ---------------------------------------------------------------------------
// LlmService's internal SystemPromptSection shape is `{ text: string; cacheable?: boolean }`.
// `assemblePrompt()` produces the same shape, and LlmService's
// `splitCacheableSystemPromptSections` collapses that array into
// `{ cacheableText, dynamicText }` for provider-native cache emission:
//   • Anthropic: `cache_control: {type:'ephemeral'}` on the last leading cacheable system block
//   • OpenAI:    `prompt_cache_key` on the request body (relies on stable prefix)
//   • Gemini:    full stable prefix preserved for provider-managed implicit caching
// This test verifies the boundary: whatever assemblePrompt emits remains
// splittable into a stable cacheable prefix + a per-turn dynamic tail.
// If anyone ever changes the field names or ordering, this test fails fast.

import {
  assemblePrompt,
  type SystemPromptSection,
} from '../../src/services/memory/promptAssembly';
import { splitCacheableSystemPromptSections } from '../../src/services/llm/core/systemPromptSections';

// Structural mirror of LlmService's private splitter — kept tiny on purpose.
function splitCacheable(sections: SystemPromptSection[]): {
  cacheableText: string;
  dynamicText: string;
} {
  const cacheable: string[] = [];
  const dynamic: string[] = [];
  let prefixClosed = false;
  for (const section of sections) {
    if (section.cacheable && !prefixClosed) {
      cacheable.push(section.text);
      continue;
    }
    prefixClosed = true;
    dynamic.push(section.text);
  }
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
    const serviceSplit = splitCacheableSystemPromptSections(sections);
    expect(split.cacheableText).toContain('You are Kavi');
    expect(split.cacheableText).not.toContain('Name: Alice');
    expect(split.dynamicText).toContain('Name: Alice');
    expect(split.dynamicText).toContain('picking up the conversation');
    expect(serviceSplit).toEqual(split);
  });

  it('treats cacheable sections after dynamic context as dynamic for prefix accounting', () => {
    const split = splitCacheableSystemPromptSections([
      { text: 'Stable A', cacheable: true },
      { text: 'Dynamic B' },
      { text: 'Late cacheable C', cacheable: true },
    ]);

    expect(split.cacheableText).toBe('Stable A');
    expect(split.dynamicText).toBe('Dynamic B\n\nLate cacheable C');
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
