import { buildToolCatalogWorkflowEdges } from '../../src/engine/tools/builtin-tool-catalogWorkflowEdges';

describe('tool catalog workflow edges', () => {
  it('projects callable state and matching resource handoffs', () => {
    expect(
      buildToolCatalogWorkflowEdges([
        {
          name: 'notification_schedule',
          description: 'Schedule',
          category: 'notifications',
          source: 'built-in',
          schemaVersion: 'v1',
          capabilitySummary: {
            capabilities: ['write'],
            resourceKinds: ['device'],
            sideEffects: ['external_run'],
            providesEvidence: [],
            workflowStages: [],
            produces: [{ kind: 'notification_id' }],
            consumes: [],
            precedes: ['notification_cancel'],
            requiresPermissionEvidence: [],
          },
          activation: {
            name: 'notification_schedule',
            eligible: true,
            callableNow: true,
            reason: 'callable_now',
          },
        },
        {
          name: 'notification_cancel',
          description: 'Cancel',
          category: 'notifications',
          source: 'built-in',
          schemaVersion: 'v1',
          capabilitySummary: {
            capabilities: ['write'],
            resourceKinds: ['device'],
            sideEffects: ['external_run'],
            providesEvidence: [],
            workflowStages: [],
            produces: [],
            consumes: [{ kind: 'notification_id' }],
            precedes: [],
            requiresPermissionEvidence: [],
          },
          activation: {
            name: 'notification_cancel',
            eligible: true,
            callableNow: false,
            reason: 'discoverable',
          },
        },
      ]),
    ).toEqual([
      {
        producer: 'notification_schedule',
        consumer: 'notification_cancel',
        resourceKinds: ['notification_id'],
        producerCallableNow: true,
        consumerCallableNow: false,
      },
    ]);
  });
});
