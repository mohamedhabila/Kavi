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
  it('renders retrieved facts in a typed relevant-facts section', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({ predicate: 'lives_in', objectText: 'Berlin' }),
        makeFact({ id: 'f2', predicate: 'role', objectText: 'Engineer' }),
      ],
    });
    expect(out.sections).toHaveLength(2);
    expect(out.sections[1].text).toContain('### Retrieved Memory');
    expect(out.sections[1].text).toContain('#### Relevant Facts');
    expect(out.sections[1].text).toContain('- user lives_in: Berlin');
    expect(out.sections[1].text).toContain('- user role: Engineer');
  });

  it('renders UI and outcome memories in separate typed sections', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          predicate: 'ui_affordance',
          objectText: '{"role":"button","name":"Save"}',
          memoryKind: 'ui_affordance',
        }),
        makeFact({
          id: 'f2',
          predicate: 'tool_outcome',
          objectText: '{"outcome":"failure"}',
          memoryKind: 'outcome',
        }),
      ],
    });
    const text = flattenPromptSections(out.sections);
    expect(text).toContain('#### Observed UI and Surface Schema');
    expect(text).toContain('kind=ui_affordance');
    expect(text).toContain('#### Outcomes and Gotchas');
    expect(text).toContain('kind=outcome');
  });

  it('annotates only low-confidence facts', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({ confidence: 0.9, objectText: 'Berlin' }),
        makeFact({ confidence: 0.3, objectText: 'Munich' }),
      ],
    });
    const text = out.sections.map((section) => section.text).join('\n');
    expect(text).toContain('Berlin');
    expect(text).not.toMatch(/Berlin.*confidence/);
    expect(text).toMatch(/Munich \(confidence 0\.30\)/);
  });

  it('bounds long retrieved fact text inside each dynamic section', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [makeFact({ objectText: 'A'.repeat(4_000) })],
    });
    const section = out.sections[1].text;
    expect(section.length).toBeLessThan(3_600);
    expect(section).toContain('\u2026');
  });

  it('keeps large retrieved UI groups compact so later affordances remain visible', () => {
    const longInventory = (id: string) =>
      makeFact({
        id,
        predicate: 'ui_inventory',
        memoryKind: 'ui_inventory',
        objectText: JSON.stringify({
          fieldLabels: ['qbulk'],
          controls: Array.from({ length: 200 }, (_, index) => ({
            role: 'button',
            name: `qbulk-control-${id}-${index}`,
          })),
          url: `https://app.example/${id}`,
          sourceRunId: 'run-packing',
          stateIndex: id,
        }),
      });
    const target = makeFact({
      id: 'ui-target',
      predicate: 'ui_affordance',
      memoryKind: 'ui_affordance',
      sourceRunId: 'run-packing',
      objectText: JSON.stringify({
        role: 'button',
        name: 'qtarget-action',
        contextLabels: ['qtarget-context'],
        url: 'https://app.example/target',
        sourceRunId: 'run-packing',
        stateIndex: 'target',
      }),
    });

    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [longInventory('a'), longInventory('b'), target],
    });
    const uiSections = out.sections.filter((section) =>
      section.text.includes('#### Observed UI and Surface Schema'),
    );
    const targetSectionIndex = uiSections.findIndex((section) =>
      section.text.includes('qtarget-action'),
    );

    expect(uiSections.every((section) => section.text.length < 3_700)).toBe(true);
    expect(targetSectionIndex).toBeGreaterThanOrEqual(0);
    expect(uiSections[targetSectionIndex].text).toContain('qtarget-context');
  });

  it('keeps multiple UI trajectory facts inside a compact dynamic section', () => {
    const retrievedFacts = [0, 1, 5, 6, 7].map((stateIndex) =>
      makeFact({
        id: `ui-${stateIndex}`,
        predicate: 'surface_inventory',
        memoryKind: 'surface_schema',
        sourceRunId: 'run-ui',
        attributes: {
          url: `https://app.example/surface/${stateIndex}`,
          action: `action-${stateIndex}`,
          thought: `evidence-${stateIndex} ${'detail '.repeat(40)}`,
          sourceRunId: 'run-ui',
          stateIndex: String(stateIndex),
        },
        objectText: `${JSON.stringify({
          url: `https://app.example/surface/${stateIndex}`,
          action: `action-${stateIndex}`,
          thought: `evidence-${stateIndex} ${'detail '.repeat(40)}`,
          sourceRunId: 'run-ui',
          stateIndex: String(stateIndex),
          nodes: Array.from({ length: 40 }, (_, index) => ({
            role: 'button',
            name: `node-${stateIndex}-${index}`,
            attributes: ['visible', 'clickable'],
          })),
        }).slice(0, 600)}...`,
      }),
    );
    const out = assemblePrompt({ basePrompt: 'BASE', retrievedFacts });
    const uiSections = out.sections.filter((section) =>
      section.text.includes('#### Observed UI and Surface Schema'),
    );
    const uiText = uiSections.map((section) => section.text).join('\n');

    expect(uiSections.length).toBeGreaterThan(0);
    expect(uiSections.every((section) => section.text.length < 5_000)).toBe(true);
    expect(uiText).toContain('stateIndex":"1');
    expect(uiText).toContain('stateIndex":"7');
    expect(uiText).not.toContain('"nodes"');
  });

  it('renders UI inventory visible controls before bulky field details', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          predicate: 'ui_inventory',
          memoryKind: 'ui_inventory',
          sourceRunId: 'run-form',
          objectText: JSON.stringify({
            nodeCount: 100,
            controlCount: 24,
            textEntryCount: 4,
            searchControlCount: 1,
            fieldLabels: ['URL', 'Image', 'Title', 'Body', 'Forum'],
            fields: [
              { order: 2, label: 'Title', role: 'textbox' },
              { order: 3, label: 'Body', role: 'textbox' },
              { order: 4, label: 'Forum', role: 'combobox', value: 'funny' },
            ],
            controls: Array.from({ length: 80 }, (_, index) => ({
              role: 'button',
              name: `bulk-control-${index}`,
            })),
            url: 'https://forum.example.test/submit/funny',
            sourceRunId: 'run-form',
            stateIndex: '21',
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('"fieldLabels":["URL","Image","Title","Body","Forum"]');
    expect(text).toContain('"visibleControls"');
    expect(text).toContain('"label":"Body"');
    expect(text).toContain('"label":"Forum"');
    expect(text.indexOf('"visibleControls"')).toBeLessThan(text.indexOf('"fields"'));
    expect(text).not.toContain('bulk-control-79');
  });

  it('renders compact table evidence before bulky UI lists', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          predicate: 'ui_inventory',
          memoryKind: 'ui_inventory',
          sourceRunId: 'run-table',
          objectText: JSON.stringify({
            nodeCount: 900,
            controlCount: 240,
            controlNames: Array.from({ length: 240 }, (_, index) => `bulk-control-${index}`),
            sections: Array.from({ length: 32 }, (_, index) => ({
              label: `section-${index}`,
              controlNames: [`bulk-control-${index}`],
            })),
            tables: [
              {
                index: 82, role: 'table',
                columnLabels: ['Description', 'Quantity', 'Total'],
                rowCount: 3, interactiveControlCount: 1,
                interactiveControls: [{ index: 88, role: 'button', name: 'Open row' }],
                columnValueSamples: [{ column: 'Total', values: ['-'] }],
                rowSamples: [{ Description: 'Loaner Laptop', Quantity: '5' }, { Total: '-' }],
              },
            ],
            url: 'https://admin.example.test/order-status',
            sourceRunId: 'run-table',
            stateIndex: '45',
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('"columnLabels":["Description","Quantity","Total"]');
    expect(text).toContain('"interactiveControls":[{"index":88,"role":"button","name":"Open row"}]');
    expect(text).toContain('"rowSamples":[{"Description":"Loaner Laptop","Quantity":"5"},{"Total":"-"}]');
    expect(text.indexOf('"tables"')).toBeGreaterThan(-1);
    expect(text.indexOf('"visibleControls"')).toBeGreaterThan(text.indexOf('"tables"'));
    expect(text).not.toContain('bulk-control-239');
  });

  it('keeps visible controls available when UI field details are verbose', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          predicate: 'ui_inventory',
          memoryKind: 'ui_inventory',
          sourceRunId: 'run-verbose-ui',
          objectText: JSON.stringify({
            controlNames: [
              'Navigate home',
              'Open menu',
              'Review status',
              'Confirm downstream action',
            ],
            fields: Array.from({ length: 24 }, (_, index) => ({
              order: index,
              label: `Verbose field ${index}`,
              role: 'textbox',
              controlName: `Verbose field ${index}`,
              value: `Long repeated value ${index} ${'x'.repeat(80)}`,
            })),
            textEntryControls: Array.from({ length: 24 }, (_, index) => ({
              index,
              role: 'textbox',
              name: `Verbose text entry ${index}`,
              value: `Long text entry value ${index} ${'y'.repeat(80)}`,
            })),
            url: 'https://app.example.test/result',
            sourceRunId: 'run-verbose-ui',
            stateIndex: '9',
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('Confirm downstream action');
    expect(text.indexOf('"visibleControls"')).toBeLessThan(text.indexOf('"fields"'));
  });

  it('keeps compact form rows visible before bulky UI section details', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          predicate: 'ui_inventory',
          memoryKind: 'ui_inventory',
          sourceRunId: 'run-settings-fields',
          objectText: JSON.stringify({
            fieldLabels: ['Language', 'Time zone', 'Front page'],
            controlNames: Array.from({ length: 80 }, (_, index) => `bulk-control-${index}`),
            fields: [
              {
                order: 0,
                label: 'Language',
                role: 'combobox',
                controlName: 'Language',
                value: 'English',
                options: Array.from({ length: 60 }, (_, index) => `language-${index}`),
              },
              {
                order: 1,
                label: 'Time zone',
                role: 'combobox',
                controlName: 'Time zone',
                value: 'UTC',
                options: Array.from({ length: 60 }, (_, index) => `timezone-${index}`),
              },
              {
                order: 2,
                label: 'Front page',
                role: 'combobox',
                controlName: 'Front page',
                value: 'Home',
                options: ['Home', 'Forums', 'Wiki'],
              },
            ],
            sections: Array.from({ length: 30 }, (_, index) => ({
              label: `section-${index}`,
              controlNames: [`bulk-control-${index}`],
            })),
            url: 'https://forum.example.test/user/settings/preferences',
            sourceRunId: 'run-settings-fields',
            stateIndex: '2',
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('"fieldRows"');
    expect(text).toContain('"label":"Front page"');
    expect(text).toContain('"options":["Home","Forums","Wiki"]');
    expect(text.indexOf('"fieldRows"')).toBeLessThan(text.indexOf('"sections"'));
    expect(text).not.toContain('language-59');
  });

  it('renders UI inventories with the visible snapshot contract and source context', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          predicate: 'ui_inventory',
          memoryKind: 'ui_inventory',
          sourceRunId: 'run-visible-state',
          objectText: JSON.stringify({
            goal: 'Review settings page controls',
            trajectoryOutcome: 'success',
            controlNames: ['Save', 'Cancel'],
            url: 'https://app.example.test/settings',
            sourceRunId: 'run-visible-state',
            stateIndex: '3',
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    for (const fragment of ['UI inventories are observed evidence for a specific URL/state', 'answer that no such control/options are present, not unknown', 'landmarkRows summarize section labels', 'use landmarkRole and structuralPath as layout evidence', 'complementary is supporting secondary content', 'Table columnLabels name columns', 'table interactiveControls are the observed controls inside that table', 'Treat rowSample values as content, not controls', 'without renaming them or inferring absent statuses', 'not members of an ordered row-value sequence', 'Count ordinals only within the requested role/context']) {
      expect(text).toContain(fragment);
    }
    expect(text).toContain('"sourceGoal":"Review settings page controls"');
    expect(text).toContain('"trajectoryOutcome":"success"');
  });

  it('renders query-specific exact label evidence before bulky UI inventory details', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          predicate: 'ui_inventory',
          memoryKind: 'ui_inventory',
          sourceRunId: 'run-visible-state',
          attributes: {
            queryQuotedControlLabelEvidence: {
              matched: [{ requested: 'Archive Item', observed: 'Archive Item' }],
            },
          },
          objectText: JSON.stringify({
            controlNames: ['Archive Item', 'Share Item'],
            url: 'https://app.example.test/items/1',
            sourceRunId: 'run-visible-state',
            stateIndex: '3',
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text).toContain('queryQuotedControlLabelEvidence');
    expect(text).toContain('exact quoted control-label evidence');
    expect(text).not.toContain('notInThisInventory');
    expect(text).not.toContain('premiseContradictions');
    expect(text.indexOf('"queryQuotedControlLabelEvidence"')).toBeLessThan(
      text.indexOf('"visibleControls"'),
    );
  });

  it('renders observed UI state before procedure traces', () => {
    const out = assemblePrompt({
      basePrompt: 'BASE',
      retrievedFacts: [
        makeFact({
          id: 'ui-1',
          subjectId: 'workflow:run-order:state:7',
          predicate: 'ui_inventory',
          memoryKind: 'ui_inventory',
          objectText: JSON.stringify({
            sourceRunId: 'run-order',
            stateIndex: '7',
            tables: [
              {
                columnLabels: ['Item', 'Stage'],
                rowSamples: [{ Item: 'Macbook Pro', Stage: 'Observed approval chain' }],
              },
            ],
          }),
        }),
        makeFact({
          id: 'procedure-1',
          subjectId: 'workflow:run-order',
          predicate: 'procedure_trace',
          memoryKind: 'procedure',
          objectText: JSON.stringify({
            sourceRunId: 'run-order',
            trajectoryOutcome: 'success',
            steps: [{ stateIndex: '1', action: "click('order')" }],
          }),
        }),
      ],
    });

    const text = flattenPromptSections(out.sections);
    expect(text.indexOf('#### Observed UI and Surface Schema')).toBeLessThan(text.indexOf('#### Procedures'));
    expect(text.indexOf('"Stage":"Observed approval chain"')).toBeLessThan(text.indexOf('procedure_trace'));
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
    const text = flattenPromptSections(out.sections);
    const idxReflection = text.indexOf('### Day Focus');
    const idxFocus = text.indexOf('<focus>FOCUS</focus>');
    const idxEpisodes = text.indexOf('### Recent Activity');
    const idxFacts = text.indexOf('### Retrieved Memory');
    const idxAddenda = text.indexOf('EXTRA');
    expect(idxReflection).toBeGreaterThan(-1);
    expect(idxFocus).toBeGreaterThan(idxReflection);
    expect(idxAddenda).toBeGreaterThan(idxFocus);
    expect(idxFacts).toBeGreaterThan(idxAddenda);
    expect(idxEpisodes).toBeGreaterThan(idxFacts);
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
