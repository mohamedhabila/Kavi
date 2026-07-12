import {
  buildPostCompactionSystemContent,
  collectCacheableProfileSections,
} from '../../../src/services/context/postCompactionReinject';

describe('postCompactionReinject', () => {
  it('reinjects stable profile context but never snapshots graph goals or constraints', () => {
    const content = buildPostCompactionSystemContent({
      summary: '[Conversation Summary]\n\n## Task Overview\nPlan dinner',
      profileSections: ['<block label="persona">Everyday assistant</block>'],
    });

    expect(content).toContain('[Conversation Summary]');
    expect(content).toContain('## Persistent Context');
    expect(content).toContain('persona');
    expect(content).not.toContain('## Current Goals');
    expect(content).not.toContain('user quote=');
  });

  it('collects cacheable profile sections only', () => {
    const sections = collectCacheableProfileSections([
      { text: 'stable profile', cacheable: true },
      { text: 'per-turn focus', cacheable: false },
    ]);

    expect(sections).toEqual(['stable profile']);
  });
});
