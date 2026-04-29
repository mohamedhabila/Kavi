// ---------------------------------------------------------------------------
// Tests — Prompt assembly (4-layer + cache breakpoint)
// ---------------------------------------------------------------------------

import {
  assemblePrompt,
  flattenPromptSections,
  type AssemblePromptInput,
} from '../../src/services/memory/promptAssembly';
import type { MemoryBlock } from '../../src/services/memory/blocks';
import type { MemoryFact } from '../../src/services/memory/facts';

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

  it('marks L1 and L2 as cacheable; L3 is dynamic', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      blocks: [makeBlock({ content: 'BLOCK' })],
      focusBlock: 'FOCUS',
    });
    expect(out.sections[0].cacheable).toBe(true);
    expect(out.sections[1].cacheable).toBe(true);
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

  it('cacheable prefix bytes are independent of L3 content', () => {
    const a = assemblePrompt({ ...baseInput, blocks: [makeBlock()], focusBlock: 'A' });
    const b = assemblePrompt({ ...baseInput, blocks: [makeBlock()], focusBlock: 'B' });
    expect(a.cacheableSignature).toBe(b.cacheableSignature);
    // L1 and L2 byte-for-byte the same.
    expect(a.sections[0].text).toBe(b.sections[0].text);
    expect(a.sections[1].text).toBe(b.sections[1].text);
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
    expect(out.sections.every((s) => s.cacheable)).toBe(true);
  });

  it('appends entityDossier under Known Entities header', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      entityDossier: 'user (self) — primary user of this device.',
    });
    expect(out.sections[1].text).toContain('## Known Entities');
    expect(out.sections[1].text).toContain('primary user of this device');
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
