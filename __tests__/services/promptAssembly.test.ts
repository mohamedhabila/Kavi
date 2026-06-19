// ---------------------------------------------------------------------------
// Tests — Prompt assembly (4-layer + cache breakpoint)
// ---------------------------------------------------------------------------

import {
  assemblePrompt,
  flattenPromptSections,
  type AssemblePromptInput,
} from '../../src/services/memory/promptAssembly';
import type { MemoryBlock } from '../../src/services/memory/blocks';
import type { MemoryFact } from '../../src/services/memory/facts/types';
import type { MemoryEpisode } from '../../src/services/memory/episodes/types';

function makeBlock(overrides: Partial<MemoryBlock> = {}): MemoryBlock {
  return {
    label: 'profile',
    description: 'Stable facts about the user.',
    content: 'Name: Mo\nRole: Engineer',
    charLimit: 1500,
    pinned: true,
    personaId: null,
    updatedAt: 1,
    ...overrides,
  };
}

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'f1',
    subjectId: 'user',
    predicate: 'lives_in',
    objectText: 'Berlin',
    objectEntityId: null,
    attributes: {},
    confidence: 0.9,
    sourceMessageId: null,
    sourceRunId: null,
    contentHash: 'h',
    embedding: null,
    validAt: 1,
    invalidAt: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    pinned: false,
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<MemoryEpisode> = {}): MemoryEpisode {
  return {
    id: 'ep-1',
    conversationId: 'conv-1',
    threadId: 'conv-1',
    taskId: null,
    startedAt: 1,
    endedAt: 2,
    summary: 'User asked to fix the config file.',
    entities: ['user'],
    messageIds: ['m1', 'm2'],
    toolNames: ['read_file'],
    importance: 0.7,
    embedding: null,
    createdAt: 2,
    deletedAt: null,
    ...overrides,
  };
}

const baseInput: AssemblePromptInput = {
  basePrompt: 'You are Kavi, a personal assistant.',
};

describe('assemblePrompt — layer ordering', () => {
  it('emits L1 first, L2 second, L3 last', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      blocks: [makeBlock({ content: 'BLOCK' })],
      focusBlock: '<focus>FOCUS</focus>',
    });
    const labels = out.sections.map((s) => s.text);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain('BASE');
    expect(labels[1]).toContain('BLOCK');
    expect(labels[2]).toContain('FOCUS');
  });

  it('marks only L1 as cacheable; memory and turn context are dynamic until epoch admission', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      blocks: [makeBlock({ content: 'BLOCK' })],
      focusBlock: 'FOCUS',
    });
    expect(out.sections[0].cacheable).toBe(true);
    expect(out.sections[1].cacheable).toBeUndefined();
    expect(out.sections[2].cacheable).toBeUndefined();
  });

  it('omits empty layers', () => {
    const onlyBase = assemblePrompt({ basePrompt: 'BASE' });
    expect(onlyBase.sections).toHaveLength(1);
    expect(onlyBase.sections[0].cacheable).toBe(true);
  });

  it('omits empty blocks (no content)', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      blocks: [makeBlock({ content: '' }), makeBlock({ label: 'preferences', content: 'concise' })],
    });
    expect(out.sections[1].text).toContain('<block label="preferences">');
    expect(out.sections[1].text).not.toContain('<block label="profile">');
  });
});

describe('assemblePrompt — deterministic ordering', () => {
  it('renders pinned blocks first, then alphabetical', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      blocks: [
        makeBlock({ label: 'preferences', pinned: false, content: 'pref' }),
        makeBlock({ label: 'persona', pinned: true, content: 'per' }),
        makeBlock({ label: 'active_focus', pinned: false, content: 'af' }),
      ],
    });
    const text = out.sections[1].text;
    const idxPersona = text.indexOf('label="persona"');
    const idxActive = text.indexOf('label="active_focus"');
    const idxPref = text.indexOf('label="preferences"');
    expect(idxPersona).toBeGreaterThan(-1);
    expect(idxPersona).toBeLessThan(idxActive);
    expect(idxActive).toBeLessThan(idxPref);
  });

  it('produces identical output for identical inputs (cache stability)', () => {
    const a = assemblePrompt({ ...baseInput, blocks: [makeBlock()] });
    const b = assemblePrompt({ ...baseInput, blocks: [makeBlock()] });
    expect(a.sections.map((s) => s.text)).toEqual(b.sections.map((s) => s.text));
    expect(a.cacheableSignature).toBe(b.cacheableSignature);
  });

  it('cacheable prefix bytes are independent of memory and L3 content', () => {
    const a = assemblePrompt({ ...baseInput, blocks: [makeBlock()], focusBlock: 'A' });
    const b = assemblePrompt({ ...baseInput, blocks: [makeBlock()], focusBlock: 'B' });
    const c = assemblePrompt({
      ...baseInput,
      blocks: [makeBlock({ content: 'Name: Mo\nRole: Designer' })],
      focusBlock: 'A',
    });
    expect(a.cacheableSignature).toBe(b.cacheableSignature);
    expect(c.cacheableSignature).toBe(a.cacheableSignature);
    // The stable prefix remains byte-for-byte identical.
    expect(a.sections[0].text).toBe(b.sections[0].text);
    expect(a.sections[0].text).toBe(c.sections[0].text);
  });
});

describe('assemblePrompt — L3 contents', () => {
  it('renders retrieved facts as a bullet list', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({ predicate: 'lives_in', objectText: 'Berlin' }),
        makeFact({ id: 'f2', predicate: 'role', objectText: 'Engineer' }),
      ],
    });
    expect(out.sections[1].text).toContain('### Retrieved Memory');
    expect(out.sections[1].text).toContain('- user lives_in: Berlin');
    expect(out.sections[1].text).toContain('- user role: Engineer');
  });

  it('annotates only low-confidence facts', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({ confidence: 0.9, objectText: 'Berlin' }),
        makeFact({ confidence: 0.3, objectText: 'Munich' }),
      ],
    });
    const text = out.sections[1].text;
    expect(text).toContain('Berlin');
    expect(text).not.toMatch(/Berlin.*confidence/);
    expect(text).toMatch(/Munich \(confidence 0\.30\)/);
  });

  it('skips L3 entirely when nothing dynamic to render', () => {
    const out = assemblePrompt({ basePrompt: 'BASE', blocks: [makeBlock()] });
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].cacheable).toBe(true);
    expect(out.sections[1].cacheable).toBeUndefined();
  });

  it('appends entityDossier under Known Entities header', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      entityDossier: 'user (self) — primary user of this device.',
    });
    expect(out.sections[1].text).toContain('## Known Entities');
    expect(out.sections[1].text).toContain('primary user of this device');
  });

  it('renders recent episodes under Recent Activity header', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      recentEpisodes: [
        makeEpisode({ summary: 'Fixed the config file.' }),
        makeEpisode({ summary: 'Added error handling.', toolNames: ['write_file'] }),
      ],
    });
    const text = out.sections[1].text;
    expect(text).toContain('### Recent Activity');
    expect(text).toContain('- Fixed the config file. [read_file]');
    expect(text).toContain('- Added error handling. [write_file]');
  });

  it('truncates episode summaries to 200 chars', () => {
    const longSummary = 'A'.repeat(300);
    const out = assemblePrompt({
      basePrompt: 'BASE',
      recentEpisodes: [makeEpisode({ summary: longSummary })],
    });
    const line = out.sections[1].text.split('\n').find((l) => l.startsWith('- '));
    expect(line!.length).toBeLessThanOrEqual(220); // 200 + prefix '- ' + tool suffix ' [read_file]'
  });

  it('omits episodes with empty summaries', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      recentEpisodes: [makeEpisode({ summary: '' }), makeEpisode({ summary: 'Valid summary' })],
    });
    const text = out.sections[1].text;
    expect(text).not.toContain('-  [');
    expect(text).toContain('- Valid summary');
  });

  it('omits tool name suffix when episode has no tools', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      recentEpisodes: [makeEpisode({ summary: 'Simple chat', toolNames: [] })],
    });
    const text = out.sections[1].text;
    expect(text).toContain('- Simple chat');
    expect(text).not.toContain('[]');
  });

  it('renders reflection under Day Focus before focus block', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      reflectionBlock: 'episode:ep-1 Saved atlas metadata',
      focusBlock: '<focus>FOCUS</focus>',
    });
    const text = out.sections[1].text;
    expect(text).toContain('### Day Focus');
    expect(text).toContain('episode:ep-1 Saved atlas metadata');
    const idxReflection = text.indexOf('### Day Focus');
    const idxFocus = text.indexOf('<focus>FOCUS</focus>');
    expect(idxReflection).toBeGreaterThan(-1);
    expect(idxFocus).toBeGreaterThan(idxReflection);
  });

  it('orders current semantic facts before passive activity traces', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      reflectionBlock: 'episode:ep-1 Daily summary',
      focusBlock: '<focus>FOCUS</focus>',
      recentEpisodes: [makeEpisode({ summary: 'Episode' })],
      retrievedFacts: [makeFact({ predicate: 'role', objectText: 'Engineer' })],
      dynamicAddenda: ['EXTRA'],
    });
    const text = out.sections[1].text;
    const idxReflection = text.indexOf('### Day Focus');
    const idxFocus = text.indexOf('<focus>FOCUS</focus>');
    const idxEpisodes = text.indexOf('### Recent Activity');
    const idxFacts = text.indexOf('### Retrieved Memory');
    const idxAddenda = text.indexOf('EXTRA');
    expect(idxReflection).toBeGreaterThan(-1);
    expect(idxFocus).toBeGreaterThan(idxReflection);
    expect(idxFacts).toBeGreaterThan(idxFocus);
    expect(idxEpisodes).toBeGreaterThan(idxFacts);
    expect(idxAddenda).toBeGreaterThan(idxEpisodes);
  });
});

describe('flattenPromptSections', () => {
  it('joins all sections with blank line separator', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      blocks: [makeBlock({ content: 'BLOCK' })],
      focusBlock: 'FOCUS',
    });
    const flat = flattenPromptSections(out.sections);
    expect(flat).toMatch(/BASE[\s\S]*BLOCK[\s\S]*FOCUS/);
  });
});
