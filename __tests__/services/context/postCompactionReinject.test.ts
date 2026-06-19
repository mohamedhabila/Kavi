import {
  buildPostCompactionSystemContent,
  collectCacheableProfileSections,
} from '../../../src/services/context/postCompactionReinject';

describe('postCompactionReinject', () => {
  it('reinjects profile blocks and goals after compaction', () => {
    const content = buildPostCompactionSystemContent({
      summary: '[Conversation Summary]\n\n## Task Overview\nPlan dinner',
      profileSections: ['<block label="persona">Everyday assistant</block>'],
      goalsPromptSection: '## Current Goals\n\n### Active\n- Cook dinner',
    });

    expect(content).toContain('[Conversation Summary]');
    expect(content).toContain('## Persistent Context');
    expect(content).toContain('persona');
    expect(content).toContain('## Current Goals');
  });

  it('collects cacheable profile sections only', () => {
    const sections = collectCacheableProfileSections([
      { text: 'stable profile', cacheable: true },
      { text: 'per-turn focus', cacheable: false },
    ]);

    expect(sections).toEqual(['stable profile']);
  });
});