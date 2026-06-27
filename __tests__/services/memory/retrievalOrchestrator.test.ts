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
import { recordFact, invalidateFact } from '../../../src/services/memory/facts/mutations';
import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
import { upsertMemoryTask } from '../../../src/services/memory/tasks';
import type { AgentGoal } from '../../../src/engine/goals/types';

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

describe('orchestrateMemoryRetrieval', () => {
  it('excludes invalidated facts from retrieval', async () => {
    const entity = upsertEntity({ name: 'user', type: 'self', now: 1 });
    const kept = recordFact({
      subjectId: entity.id,
      predicate: 'prefers_theme',
      objectText: 'dark',
      scope: 'global',
      now: 1,
    }).fact;
    const removed = recordFact({
      subjectId: entity.id,
      predicate: 'prefers_theme',
      objectText: 'light',
      scope: 'global',
      now: 2,
    }).fact;
    invalidateFact(removed.id, 3);

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'theme preference',
      limit: 5,
      now: 4,
    });

    expect(result.facts.some((fact) => fact.id === kept.id)).toBe(true);
    expect(result.facts.some((fact) => fact.id === removed.id)).toBe(false);
  });

  it('keeps pinned facts and uses goal signals in the query', async () => {
    const entity = upsertEntity({ name: 'project', type: 'concept', now: 1 });
    const pinned = recordFact({
      subjectId: entity.id,
      predicate: 'name',
      objectText: 'Atlas',
      scope: 'global',
      pinned: true,
      now: 1,
    }).fact;

    const goals: AgentGoal[] = [
      {
        id: 'goal-atlas',
        title: 'Atlas migration',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    upsertMemoryTask({
      id: 'goal-atlas',
      threadId: 'conv-1',
      title: 'Atlas migration',
      now: 1,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'status update',
      goals,
      activeTaskId: 'goal-atlas',
      conversationId: 'conv-1',
      taskId: 'goal-atlas',
      limit: 5,
      now: 2,
    });

    expect(result.querySignals).toEqual(
      expect.arrayContaining(['status update', 'Atlas migration']),
    );
    expect(result.facts.some((fact) => fact.id === pinned.id)).toBe(true);
  });

  it('uses active focus text as a fallback retrieval signal', async () => {
    const entity = upsertEntity({ name: 'release', type: 'project', now: 1 });
    const focusFact = recordFact({
      subjectId: entity.id,
      predicate: 'handoff_token',
      objectText: 'NEBULA-FOCUS-E2E',
      scope: 'conversation',
      originConversationId: 'conv-focus',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: '',
      focusText: 'NEBULA-FOCUS-E2E release validation',
      conversationId: 'conv-focus',
      limit: 5,
      now: 2,
    });

    expect(result.querySignals).toEqual(
      expect.arrayContaining(['NEBULA-FOCUS-E2E release validation']),
    );
    expect(result.facts.some((fact) => fact.id === focusFact.id)).toBe(true);
  });

  it('prioritizes explicit request signals over stale active focus', async () => {
    const relevantEntity = upsertEntity({ name: 'forum', type: 'project', now: 1 });
    const staleEntity = upsertEntity({ name: 'catalog', type: 'project', now: 1 });
    const relevantFact = recordFact({
      subjectId: relevantEntity.id,
      predicate: 'homepage_control',
      objectText: 'CUSTOM-FORUM-HOME-TOKEN has no direct submit textbox',
      scope: 'conversation',
      originConversationId: 'conv-focus-priority',
      now: 1,
    }).fact;
    const staleFact = recordFact({
      subjectId: staleEntity.id,
      predicate: 'review_state',
      objectText: 'STALE-FOCUS-TOKEN product review workflow',
      scope: 'conversation',
      originConversationId: 'conv-focus-priority',
      now: 2,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'CUSTOM-FORUM-HOME-TOKEN direct submit textbox',
      focusText: 'STALE-FOCUS-TOKEN product review workflow',
      conversationId: 'conv-focus-priority',
      limit: 1,
      now: 3,
    });

    expect(result.facts.map((fact) => fact.id)).toEqual([relevantFact.id]);
    expect(result.facts.some((fact) => fact.id === staleFact.id)).toBe(false);
  });

  it('retrieves interface memories through a dedicated lane', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test', type: 'project' });
    const profile = upsertEntity({ name: 'profile', type: 'concept' });
    const uiFact = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText:
        '{"controls":[{"role":"button","name":"Save"}],"url":"https://app.example.test/settings"}',
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-ui-lane',
      now: 1,
    }).fact;
    recordFact({
      subjectId: profile.id,
      predicate: 'settings_note',
      objectText: 'settings page was recently discussed',
      memoryKind: 'semantic_fact',
      scope: 'conversation',
      originConversationId: 'conv-ui-lane',
      now: 2,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'settings Save button',
      conversationId: 'conv-ui-lane',
      limit: 3,
      now: 3,
    });

    const interfaceLane = result.lanes.find((lane) => lane.id === 'interface');
    expect(interfaceLane?.facts.some((fact) => fact.id === uiFact.id)).toBe(true);
    expect(result.facts.some((fact) => fact.id === uiFact.id)).toBe(true);
  });

  it('keeps short structured UI labels addressable in large inventories', async () => {
    const surface = upsertEntity({
      name: 'surface:https://dense.example.test',
      type: 'project',
    });
    const longControlNames = Array.from(
      { length: 260 },
      (_, index) => `qlongcontrolname${String(index).padStart(3, '0')}suffixvalue`,
    );
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://dense.example.test/current',
        controlNames: ['qsave', ...longControlNames],
        sections: [
          {
            label: 'qpanel',
            controlNames: ['qsave'],
          },
        ],
      }),
      sourceRunId: 'dense-ui-run',
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-dense-ui-labels',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'qsave',
      conversationId: 'conv-dense-ui-labels',
      limit: 1,
      now: 2,
    });

    expect(result.facts.map((fact) => fact.id)).toEqual([target.id]);
  });

  it('routes code-heavy action schemas to relevant typed UI evidence', async () => {
    const adminSurface = upsertEntity({
      name: 'surface:https://admin.example.test',
      type: 'project',
    });
    const storefrontSurface = upsertEntity({
      name: 'surface:https://shop.example.test',
      type: 'project',
    });
    const relevant = recordFact({
      subjectId: adminSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://admin.example.test/orders',
        fields: [{ label: 'Order state', role: 'combobox', value: 'Archived' }],
        labelValues: [{ label: 'Order state', value: 'Archived' }],
      }),
      attributes: {
        url: 'https://admin.example.test/orders',
        sourceRunId: 'admin-run',
        stateIndex: 2,
      },
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-code-heavy-query',
      now: 1,
    }).fact;
    recordFact({
      subjectId: storefrontSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://shop.example.test/search',
        controls: [{ role: 'button', name: 'Buy' }],
      }),
      attributes: {
        url: 'https://shop.example.test/search',
        sourceRunId: 'storefront-run',
        stateIndex: 1,
      },
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-code-heavy-query',
      now: 100,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: [
        'I need the admin orders page state filter evidence.',
        'scroll(delta_x: float, delta_y: float), click(bid: str), fill(bid: str, value: str), select_option(bid: str, options: str | list[str])',
      ].join('\n'),
      conversationId: 'conv-code-heavy-query',
      limit: 2,
      now: 200,
    });

    expect(result.querySignals).toContain('I need the admin orders page state filter evidence.');
    expect(result.querySignals.join('\n')).not.toContain('select_option');
    expect(result.facts.some((fact) => fact.id === relevant.id)).toBe(true);
  });

  it('retrieves surrounding interface evidence when a quoted target is absent', async () => {
    const adminSurface = upsertEntity({
      name: 'surface:https://admin.example.test',
      type: 'project',
    });
    const otherSurface = upsertEntity({
      name: 'surface:https://docs.example.test',
      type: 'project',
    });
    const relevant = recordFact({
      subjectId: adminSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://admin.example.test/orders',
        fieldLabels: ['Status'],
        labelValues: [
          { label: 'Status', value: 'Canceled' },
          { label: 'Status', value: 'Complete' },
        ],
        controls: [{ role: 'button', name: 'Filters' }],
      }),
      attributes: {
        url: 'https://admin.example.test/orders',
        sourceRunId: 'admin-orders-run',
        stateIndex: 4,
      },
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-absent-target',
      now: 1,
    }).fact;
    recordFact({
      subjectId: otherSurface.id,
      predicate: 'semantic_note',
      objectText: 'Fraud Suspect Resolution is referenced in a support article title.',
      memoryKind: 'semantic_fact',
      scope: 'conversation',
      originConversationId: 'conv-absent-target',
      now: 100,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage:
        'On the admin orders page, can I filter order status by `Fraud Suspect Resolution`?',
      conversationId: 'conv-absent-target',
      limit: 1,
      now: 200,
    });

    expect(result.querySignals[0]).toContain('On the admin orders page');
    expect(result.querySignals[0]).not.toContain('Fraud Suspect Resolution');
    expect(result.facts.map((fact) => fact.id)).toEqual([relevant.id]);
  });

  it('reranks interface source groups by full query coverage over isolated span matches', async () => {
    const relevantSurface = upsertEntity({
      name: 'surface:https://admin.example.test',
      type: 'project',
    });
    const otherSurface = upsertEntity({
      name: 'surface:https://catalog.example.test',
      type: 'project',
    });
    const relevant = recordFact({
      subjectId: relevantSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://admin.example.test/orders',
        fieldLabels: ['qordersstatus'],
        controlNames: ['qorderspage', 'qstatusfilter', 'qapplyfilter'],
      }),
      sourceRunId: 'orders-source-run',
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-source-full-query',
      now: 1,
    }).fact;
    for (let index = 0; index < 8; index += 1) {
      recordFact({
        subjectId: otherSurface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          url: `https://catalog.example.test/${index}`,
          controlNames: ['qisolatedtarget'],
        }),
        sourceRunId: `isolated-source-run-${index}`,
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: 'conv-source-full-query',
        now: 100 + index,
      });
    }

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'qorderspage qstatusfilter `qisolatedtarget`',
      conversationId: 'conv-source-full-query',
      limit: 1,
      now: 200,
    });

    expect(result.facts.map((fact) => fact.id)).toEqual([relevant.id]);
  });

  it('keeps compact form evidence when generic interface inventories share the same surface', async () => {
    const genericSurface = upsertEntity({
      name: 'surface:https://forum.example.test',
      type: 'project',
    });
    const targetSurface = upsertEntity({
      name: 'surface:https://forum.example.test',
      type: 'project',
    });

    for (let index = 0; index < 8; index += 1) {
      recordFact({
        subjectId: genericSurface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          url: `https://forum.example.test/create_forum/${index}`,
          fieldLabels: [
            'qform-field-alpha',
            'qform-field-beta',
            'qform-field-gamma',
            'qform-field-delta',
            'qform-field-epsilon',
          ],
          controlNames: [
            'qnav-alpha',
            'qnav-beta',
            'qsubmit-alpha',
            'qsubmit-beta',
          ],
        }),
        attributes: {
          sourceRunId: 'generic-forum-run',
          stateIndex: index,
        },
        sourceRunId: 'generic-forum-run',
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: 'conv-source-aware-form',
        importance: 0.9,
        now: 100 + index,
      });
    }

    const target = recordFact({
      subjectId: targetSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://forum.example.test/submit/funny',
        fieldLabels: ['URL', 'Image', 'Title', 'Body', 'Forum'],
        fields: [
          { order: 2, label: 'Title', role: 'textbox' },
          { order: 3, label: 'Body', role: 'textbox' },
          { order: 4, label: 'Forum', role: 'combobox', value: 'funny' },
        ],
      }),
      attributes: {
        sourceRunId: 'submission-form-run',
        stateIndex: 7,
      },
      sourceRunId: 'submission-form-run',
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-source-aware-form',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'create submission form field between body and forum',
      conversationId: 'conv-source-aware-form',
      limit: 4,
      now: 200,
    });

    expect(result.facts.some((fact) => fact.id === target.id)).toBe(true);
  });

  it('retrieves interface field memories through captured option values', async () => {
    const adminSurface = upsertEntity({
      name: 'surface:https://admin.example.test',
      type: 'project',
    });
    const optionFact = recordFact({
      subjectId: adminSurface.id,
      predicate: 'ui_field',
      objectText: JSON.stringify({
        label: 'Status',
        role: 'combobox',
        value: 'Complete',
        options: ['Canceled', 'Closed', 'Complete', 'Suspected Fraud', 'Processing'],
        url: 'https://admin.example.test/orders',
      }),
      attributes: {
        label: 'Status',
        role: 'combobox',
        value: 'Complete',
        options: ['Canceled', 'Closed', 'Complete', 'Suspected Fraud', 'Processing'],
        sourceRunId: 'order-status-options-run',
        stateIndex: 5,
      },
      sourceRunId: 'order-status-options-run',
      memoryKind: 'ui_field',
      scope: 'conversation',
      originConversationId: 'conv-status-options',
      now: 1,
    }).fact;

    recordFact({
      subjectId: adminSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://admin.example.test/orders',
        fieldLabels: ['Status'],
        controlNames: ['Orders', 'Filters'],
      }),
      attributes: {
        sourceRunId: 'generic-orders-run',
        stateIndex: 1,
      },
      sourceRunId: 'generic-orders-run',
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-status-options',
      importance: 0.9,
      now: 100,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'Fraud Suspect Resolution status filter',
      conversationId: 'conv-status-options',
      limit: 3,
      now: 200,
    });

    expect(result.facts.some((fact) => fact.id === optionFact.id)).toBe(true);
  });

});
