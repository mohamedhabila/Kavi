jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { AgentGoal } from '../../../src/engine/goals/types';
import { upsertEntity } from '../../../src/services/memory/entities';
import { invalidateFact, recordFact } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { orchestrateMemoryRetrieval } from '../../../src/services/memory/retrievalOrchestrator';
import { upsertMemoryTask } from '../../../src/services/memory/tasks';

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
  it('excludes invalidated facts from unified retrieval', async () => {
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

  it('keeps pinned facts and includes active goal/task signals', async () => {
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

  it('includes focus text alongside the current request signal', async () => {
    const entity = upsertEntity({ name: 'release', type: 'project', now: 1 });
    const focusFact = recordFact({
      subjectId: entity.id,
      predicate: 'handoff_token',
      objectText: 'NEBULA-FOCUS-E2E',
      scope: 'conversation',
      originConversationId: 'conv-focus',
      now: 1,
    }).fact;
    const staleFact = recordFact({
      subjectId: entity.id,
      predicate: 'handoff_token',
      objectText: 'STALE-FOCUS-TOKEN',
      scope: 'conversation',
      originConversationId: 'conv-focus',
      now: 2,
    }).fact;

    const fallback = await orchestrateMemoryRetrieval({
      userMessage: '',
      focusText: 'NEBULA-FOCUS-E2E release validation',
      conversationId: 'conv-focus',
      limit: 5,
      now: 3,
    });
    const currentRequest = await orchestrateMemoryRetrieval({
      userMessage: 'release validation',
      focusText: 'NEBULA-FOCUS-E2E current screen',
      conversationId: 'conv-focus',
      limit: 1,
      now: 4,
    });

    expect(fallback.facts.some((fact) => fact.id === focusFact.id)).toBe(true);
    expect(currentRequest.querySignals).toEqual(
      expect.arrayContaining(['release validation', 'NEBULA-FOCUS-E2E current screen']),
    );
    expect(currentRequest.facts.map((fact) => fact.id)).toEqual([focusFact.id]);
    expect(currentRequest.facts.some((fact) => fact.id === staleFact.id)).toBe(false);
  });

  it('retrieves UI inventory facts through the same unified pool as semantic facts', async () => {
    const surface = upsertEntity({ name: 'surface:https://app.example.test', type: 'project' });
    const profile = upsertEntity({ name: 'profile', type: 'concept' });
    const uiFact = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        controlNames: ['qaction-save'],
        url: 'https://app.example.test/settings',
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-ui-unified',
      now: 1,
    }).fact;
    recordFact({
      subjectId: profile.id,
      predicate: 'settings_note',
      objectText: 'settings page was recently discussed',
      memoryKind: 'semantic_fact',
      scope: 'conversation',
      originConversationId: 'conv-ui-unified',
      now: 2,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'settings `qaction-save`',
      conversationId: 'conv-ui-unified',
      limit: 3,
      now: 3,
    });

    expect(result.facts.some((fact) => fact.id === uiFact.id)).toBe(true);
  });

  it('adds bounded downstream source-run support without unrelated workflow noise', async () => {
    const surface = upsertEntity({
      name: 'surface:https://workflow.example.test',
      type: 'project',
    });
    const anchor = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://workflow.example.test/start',
        controlNames: ['qworkflow-anchor'],
      }),
      sourceRunId: 'run-workflow-packet',
      attributes: { stateIndex: '0', url: 'https://workflow.example.test/start' },
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-workflow-packet',
      now: 1,
    }).fact;
    const latest = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://workflow.example.test/result',
        sections: [{ label: 'qresult-panel', controlNames: ['qfinal-control'] }],
      }),
      sourceRunId: 'run-workflow-packet',
      attributes: { stateIndex: '4', url: 'https://workflow.example.test/result' },
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-workflow-packet',
      now: 2,
    }).fact;
    recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://workflow.example.test/noise',
        sections: [{ label: 'qnoise-panel', controlNames: ['qnoise-control'] }],
      }),
      sourceRunId: 'run-workflow-noise',
      attributes: { stateIndex: '9', url: 'https://workflow.example.test/noise' },
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-workflow-packet',
      now: 3,
    });

    const result = await orchestrateMemoryRetrieval({
      userMessage: 'qworkflow-anchor',
      conversationId: 'conv-workflow-packet',
      limit: 4,
      now: 10,
    });

    expect(result.facts.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([anchor.id]),
    );
    expect(result.facts.some((fact) => fact.id === latest.id)).toBe(true);
    expect(result.facts.some((fact) => fact.sourceRunId === 'run-workflow-noise')).toBe(false);
  });

  it('does not rank a post-transition UI state from previous-state-only controls', async () => {
    const surface = upsertEntity({
      name: 'surface:https://workflow.example.test',
      type: 'project',
    });
    const target = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://workflow.example.test/result',
        controlNames: ['qresult-alpha', 'qresult-beta'],
        sections: [
          {
            label: 'qsection-result',
            controlNames: ['qresult-alpha', 'qresult-beta'],
          },
        ],
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-transition',
      now: 1,
    }).fact;
    for (let index = 0; index < 20; index += 1) {
      recordFact({
        subjectId: surface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          url: `https://workflow.example.test/noise/${index}`,
          controlNames: ['qtransition-submit', `qnoise-${index}`],
        }),
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: 'conv-transition',
        now: 100 + index,
      });
    }

    const result = await orchestrateMemoryRetrieval({
      userMessage: '`qtransition-submit`',
      conversationId: 'conv-transition',
      limit: 1,
      now: 200,
    });

    expect(result.facts.some((fact) => fact.id === target.id)).toBe(false);
  });

  it('recalls separate user-message lines before merging multi-signal results', async () => {
    const primaryEntity = upsertEntity({
      name: 'surface:https://primary-signal.example.test',
      type: 'project',
    });
    const tailEntity = upsertEntity({
      name: 'surface:https://tail-signal.example.test',
      type: 'project',
    });
    const primaryFact = recordFact({
      subjectId: primaryEntity.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://primary-signal.example.test',
        controlNames: ['qprimary-task-token'],
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-multi-signal',
      now: 1,
    }).fact;
    const tailFact = recordFact({
      subjectId: tailEntity.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://tail-signal.example.test',
        controlNames: ['qformat-tail-token'],
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-multi-signal',
      now: 2,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: [
        'Find qprimary-task-token on the current screen.',
        'Return qformat-tail-token format.',
      ].join('\n'),
      conversationId: 'conv-multi-signal',
      limit: 1,
      now: 3,
    });

    expect(result.querySignals).toEqual([
      'Find qprimary-task-token on the current screen.',
      'Return qformat-tail-token format.',
    ]);
    expect(result.facts.map((fact) => fact.id)).toEqual([primaryFact.id]);
    expect(result.facts.some((fact) => fact.id === tailFact.id)).toBe(false);
  });

  it('uses content-bearing attachment lines without recalling standalone markers', async () => {
    const surface = upsertEntity({
      name: 'surface:https://attachment-signal.example.test',
      type: 'project',
    });
    const relevant = recordFact({
      subjectId: surface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://attachment-signal.example.test/current',
        surfaceLabels: ['qattachment-detail-token'],
        controlNames: ['qattachment-action-token'],
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-attachment-signal',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: [
        'Find the current attached surface evidence.',
        '<attachment>',
        '[1]',
        'metadata:',
        'qattachment-detail-token is visible beside qattachment-action-token.',
      ].join('\n'),
      conversationId: 'conv-attachment-signal',
      limit: 1,
      now: 2,
    });

    expect(result.querySignals).toEqual([
      'Find the current attached surface evidence.',
      'qattachment-detail-token is visible beside qattachment-action-token.',
    ]);
    expect(result.facts.map((fact) => fact.id)).toEqual([relevant.id]);
  });

  it('does not let broad earlier-signal matches crowd out precise later content', async () => {
    const broadSurface = upsertEntity({
      name: 'surface:https://broad-signal.example.test',
      type: 'project',
    });
    const targetSurface = upsertEntity({
      name: 'surface:https://precise-signal.example.test',
      type: 'project',
    });
    for (let index = 0; index < 12; index += 1) {
      recordFact({
        subjectId: broadSurface.id,
        predicate: 'ui_inventory',
        objectText: JSON.stringify({
          url: `https://broad-signal.example.test/${index}`,
          controlNames: ['qbroad-anchor', `qbroad-noise-${index}`],
        }),
        memoryKind: 'ui_inventory',
        scope: 'conversation',
        originConversationId: 'conv-precise-later-signal',
        now: index + 1,
      });
    }
    const precise = recordFact({
      subjectId: targetSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://precise-signal.example.test/current',
        controlNames: ['qprecise-later-anchor'],
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-precise-later-signal',
      now: 50,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: [
        'Find qbroad-anchor on the current surface.',
        '<attachment>',
        '[1]',
        'qprecise-later-anchor is visible on the attached current surface.',
      ].join('\n'),
      conversationId: 'conv-precise-later-signal',
      limit: 8,
      now: 100,
    });

    expect(result.querySignals).toEqual([
      'Find qbroad-anchor on the current surface.',
      'qprecise-later-anchor is visible on the attached current surface.',
    ]);
    expect(result.facts.some((fact) => fact.id === precise.id)).toBe(true);
  });

  it('drops dense tool signatures while retaining natural query context', async () => {
    const adminSurface = upsertEntity({
      name: 'surface:https://admin.example.test',
      type: 'project',
    });
    const relevant = recordFact({
      subjectId: adminSurface.id,
      predicate: 'ui_inventory',
      objectText: JSON.stringify({
        url: 'https://admin.example.test/orders',
        fields: [{ label: 'qorder-state', role: 'combobox', value: 'qarchived' }],
        labelValues: [{ label: 'qorder-state', value: 'qarchived' }],
      }),
      memoryKind: 'ui_inventory',
      scope: 'conversation',
      originConversationId: 'conv-code-heavy-query',
      now: 1,
    }).fact;

    const result = await orchestrateMemoryRetrieval({
      userMessage: [
        'I need the admin orders page qorder-state evidence.',
        'scroll(delta_x: float, delta_y: float), click(bid: str), fill(bid: str, value: str), select_option(bid: str, options: str | list[str])',
      ].join('\n'),
      conversationId: 'conv-code-heavy-query',
      limit: 2,
      now: 200,
    });

    expect(result.querySignals).toContain('I need the admin orders page qorder-state evidence.');
    expect(result.querySignals.join('\n')).not.toContain('select_option');
    expect(result.facts.some((fact) => fact.id === relevant.id)).toBe(true);
  });
});
