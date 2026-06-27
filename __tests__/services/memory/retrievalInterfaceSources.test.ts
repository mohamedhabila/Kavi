jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
import {
  recallSourceLinkedInterfaceFacts,
  selectSourceAwareInterfaceFacts,
} from '../../../src/services/memory/retrievalInterfaceSources';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import type { ScoredFact } from '../../../src/services/memory/factRecall';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function scoredFact(fact: MemoryFact, score: number): ScoredFact {
  return {
    fact,
    score,
    vectorScore: 0,
    textScore: score,
    pinnedBoost: 0,
    decayMultiplier: 1,
    scopeBoost: 0,
    reinforcementBoost: 0,
    importanceScore: 0,
    retrievabilityScore: 1,
    relevanceScore: score,
  };
}

describe('interface memory source retrieval', () => {
  it('probes extracted interface signals independently before source grouping', async () => {
    const adminSurface = upsertEntity({
      name: 'surface:https://admin.example.test',
      type: 'project',
    });
    const commonUnits = Array.from({ length: 4 }, (_, index) => `qcommon${index}`);
    for (let sourceIndex = 0; sourceIndex < 40; sourceIndex += 1) {
      recordFact({
        subjectId: adminSurface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          fieldLabels: [commonUnits[sourceIndex % commonUnits.length]],
          fields: [
            {
              order: 0,
              label: commonUnits[sourceIndex % commonUnits.length],
              role: 'textbox',
            },
          ],
          url: `https://admin.example.test/noisy/${sourceIndex}`,
        }),
        sourceRunId: `noisy-interface-run-${sourceIndex}`,
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: 'conv-independent-interface-probes',
        now: 100 + sourceIndex,
      });
    }
    const optionFact = recordFact({
      subjectId: adminSurface.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        label: 'qtargetfield',
        role: 'combobox',
        options: ['qtargetoption'],
        url: 'https://admin.example.test/relevant',
      }),
      sourceRunId: 'target-interface-run',
      memoryKind: 'ui_field',
      scope: 'conversation',
      originConversationId: 'conv-independent-interface-probes',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: [
        `Need ${commonUnits.join(' ')} and \`qmissing qtargetoption\`.`,
        'scroll(delta_x: float, delta_y: float), click(bid: str), select_option(bid: str, options: str | list[str])',
      ].join('\n'),
      conversationId: 'conv-independent-interface-probes',
      limit: 2,
      now: 200,
    });

    expect(result.facts.some((fact) => fact.id === optionFact.id)).toBe(true);
  });

  it('interleaves independent interface probes before the candidate pool fills', async () => {
    const surface = upsertEntity({
      name: 'surface:https://admin.example.test',
      type: 'project',
    });
    for (let index = 0; index < 48; index += 1) {
      recordFact({
        subjectId: surface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          controlNames: ['qbroadcontext'],
          url: `https://admin.example.test/noisy/${index}`,
        }),
        sourceRunId: `broad-source-${index}`,
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: 'conv-interleaved-interface-probes',
        now: 100 + index,
      });
    }
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        label: 'qtargetoption',
        role: 'combobox',
        options: ['qtargetoption'],
        url: 'https://admin.example.test/target',
      }),
      sourceRunId: 'target-probe-source',
      memoryKind: 'ui_field',
      scope: 'conversation',
      originConversationId: 'conv-interleaved-interface-probes',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'qbroadcontext `qtargetoption`',
      conversationId: 'conv-interleaved-interface-probes',
      limit: 2,
      now: 200,
    });

    expect(result.facts.some((fact) => fact.id === target.id)).toBe(true);
  });

  it('prefers query-relevant source-linked UI states over later states', () => {
    const surface = upsertEntity({
      name: 'surface:https://forum.example.test',
      type: 'project',
    });
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://forum.example.test/user/current',
        sections: [
          {
            label: 'qsection-alpha',
            controlNames: ['qsection-target-action'],
          },
        ],
        controlNames: ['qsection-target-action'],
      }),
      sourceRunId: 'source-linked-query-state',
      memoryKind: 'ui_inventory',
      attributes: {
        url: 'https://forum.example.test/user/current',
        stateIndex: '1',
      },
      now: 1,
    }).fact;
    for (let index = 2; index <= 6; index += 1) {
      recordFact({
        subjectId: surface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          url: `https://forum.example.test/noisy/${index}`,
          sections: [
            {
              label: 'qsection-noise',
              controlNames: [`qnoise-${index}`],
            },
          ],
          controlNames: [`qnoise-${index}`],
        }),
        sourceRunId: 'source-linked-query-state',
        memoryKind: 'ui_inventory',
        attributes: {
          url: `https://forum.example.test/noisy/${index}`,
          stateIndex: String(index),
        },
        now: index,
      });
    }

    const laneEntry = scoredFact(target, 0.25);
    const linked = recallSourceLinkedInterfaceFacts(
      [
        {
          id: 'interface',
          scoredFacts: [laneEntry],
          facts: [target],
        },
      ],
      {},
      'qsection-alpha qsection-target-action',
    );

    expect(linked[0].fact.id).toBe(target.id);
  });

  it('links relevant non-interface source runs back to their UI inventories', () => {
    const surface = upsertEntity({
      name: 'surface:https://forum.example.test',
      type: 'project',
    });
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://forum.example.test/user/other',
        sections: [
          {
            label: 'qsection-alpha',
            controlNames: ['qsection-other-action'],
          },
        ],
        controlNames: ['qsection-other-action'],
      }),
      sourceRunId: 'source-linked-procedure-state',
      memoryKind: 'ui_inventory',
      attributes: {
        url: 'https://forum.example.test/user/other',
        stateIndex: '2',
      },
      now: 2,
    }).fact;
    const outcome = recordFact({
      subjectId: surface.id,
      predicate: 'tool_outcome',
      objectText: JSON.stringify({
        outcome: 'success',
        sourceRunId: 'source-linked-procedure-state',
      }),
      sourceRunId: 'source-linked-procedure-state',
      memoryKind: 'outcome',
      now: 3,
    }).fact;

    const linked = recallSourceLinkedInterfaceFacts(
      [
        {
          id: 'procedural',
          scoredFacts: [scoredFact(outcome, 0.25)],
          facts: [outcome],
        },
      ],
      {},
      'qsection-alpha qsection-other-action',
    );

    expect(linked.map((entry) => entry.fact.id)).toContain(target.id);
  });

  it('expands terminal UI state from a relevant interface source run', async () => {
    const now = Date.now();
    const surface = upsertEntity({
      name: 'surface:https://workflow.example.test',
      type: 'project',
    });
    const anchor = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['qsource-anchor'],
        url: 'https://workflow.example.test/edit',
      }),
      attributes: {
        url: 'https://workflow.example.test/edit',
        stateIndex: '1',
      },
      sourceRunId: 'qsource-run',
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-interface-source-linked',
      now,
    }).fact;
    const terminal = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['qterminal-control'],
        url: 'https://workflow.example.test/done',
      }),
      attributes: {
        url: 'https://workflow.example.test/done',
        stateIndex: '4',
      },
      sourceRunId: 'qsource-run',
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-interface-source-linked',
      now: now + 4,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'qsource-anchor',
      conversationId: 'conv-interface-source-linked',
      limit: 2,
      now: now + 10,
    });

    expect(result.facts.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([anchor.id, terminal.id]),
    );
  });

  it('diversifies explicit UI section anchors by distinct matched control sets', () => {
    const surface = upsertEntity({
      name: 'surface:https://forum.example.test',
      type: 'project',
    });
    const repeatedGeneric = Array.from({ length: 4 }, (_, index) =>
      recordFact({
        subjectId: surface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          url: `https://forum.example.test/generic/${index}`,
          sections: [
            {
              label: 'qsection-anchor',
              controlNames: ['qvariant-generic-a', 'qvariant-generic-b'],
            },
          ],
          controlNames: ['qvariant-generic-a', 'qvariant-generic-b'],
        }),
        sourceRunId: `generic-source-${index}`,
        memoryKind: 'ui_inventory',
        now: 100 + index,
      }).fact,
    );
    const firstDistinct = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://forum.example.test/distinct/one',
        sections: [
          {
            label: 'qsection-anchor',
            controlNames: ['qvariant-distinct-one'],
          },
        ],
        controlNames: ['qvariant-distinct-one'],
      }),
      sourceRunId: 'distinct-source-one',
      memoryKind: 'ui_inventory',
      now: 1,
    }).fact;
    const secondDistinct = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://forum.example.test/distinct/two',
        sections: [
          {
            label: 'qsection-anchor',
            controlNames: ['qvariant-distinct-two'],
          },
        ],
        controlNames: ['qvariant-distinct-two'],
      }),
      sourceRunId: 'distinct-source-two',
      memoryKind: 'ui_inventory',
      now: 2,
    }).fact;

    const entries = [
      ...repeatedGeneric.map((fact, index) => scoredFact(fact, 0.9 - index * 0.01)),
      scoredFact(firstDistinct, 0.2),
      scoredFact(secondDistinct, 0.19),
    ];
    const selected = selectSourceAwareInterfaceFacts(
      entries,
      "qactor-one's `qsection-anchor` comparison",
      3,
    );

    expect(selected.map((entry) => entry.fact.id)).toEqual(
      expect.arrayContaining([repeatedGeneric[0].id, firstDistinct.id, secondDistinct.id]),
    );
  });
});
