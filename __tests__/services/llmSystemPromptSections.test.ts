import {
  selectByteEquivalentSystemPromptSections,
  splitCacheableSystemPromptSections,
} from '../../src/services/llm/core/systemPromptSections';

describe('provider-neutral system prompt section approval', () => {
  const sections = [
    { text: 'Stable instructions', cacheable: true },
    { text: 'Dynamic request context' },
  ];

  it('retains cache metadata only when the sections are byte-equivalent to the approved prompt', () => {
    const approved = selectByteEquivalentSystemPromptSections(
      [
        { role: 'system', content: 'Stable instructions\n\nDynamic request context' },
        { role: 'user', content: 'Continue' },
      ],
      sections,
    );

    expect(approved).toEqual(sections);
    expect(splitCacheableSystemPromptSections(approved)).toEqual({
      cacheableText: 'Stable instructions',
      dynamicText: 'Dynamic request context',
    });
  });

  it.each([
    {
      label: 'truncated prompt',
      messages: [{ role: 'system', content: 'Stable instructions\n\n[context truncated]' }],
    },
    {
      label: 'multiple system messages',
      messages: [
        { role: 'system', content: 'Stable instructions' },
        { role: 'system', content: 'Dynamic request context' },
      ],
    },
    {
      label: 'structured system content',
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: 'Stable instructions\n\nDynamic request context' }],
        },
      ],
    },
  ])('rejects $label instead of exposing stale sections', ({ messages }) => {
    expect(selectByteEquivalentSystemPromptSections(messages, sections)).toBeUndefined();
  });
});
