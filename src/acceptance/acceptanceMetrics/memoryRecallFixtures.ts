// ---------------------------------------------------------------------------
// Kavi — 3-turn interdependent memory recall fixtures
// ---------------------------------------------------------------------------
// Structural tokens (paths, ids) — not English keyword heuristics.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';

export type MemoryRecallFixture = {
  id: string;
  threadId: string;
  turn1: Message[];
  turn2: Message[];
  turn3Query: string;
  requiredStructuralTokens: string[];
};

function closedAssistant(
  id: string,
  content: string,
  timestamp: number,
  toolCalls?: Message['toolCalls'],
): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp,
    ...(toolCalls ? { toolCalls } : {}),
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  };
}

function writeFileToolCall(id: string, path: string): NonNullable<Message['toolCalls']>[number] {
  return {
    id,
    name: 'write_file',
    arguments: JSON.stringify({ path }),
    status: 'completed',
  };
}

export const MEMORY_RECALL_FIXTURES: MemoryRecallFixture[] = [
  {
    id: 'recall-atlas-metadata',
    threadId: 'conv-recall-atlas',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Persist project metadata', timestamp: 1 },
      closedAssistant('a-1', 'Saved project metadata.', 2, [
        writeFileToolCall('tc-1', 'projects/atlas/metadata.json'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Continue setup', timestamp: 3 },
      closedAssistant('a-2', 'Setup continues.', 4),
    ],
    turn3Query: 'projects/atlas/metadata.json',
    requiredStructuralTokens: ['projects/atlas/metadata.json', 'atlas'],
  },
  {
    id: 'recall-nebula-config',
    threadId: 'conv-recall-nebula',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Store nebula config', timestamp: 1 },
      closedAssistant('a-1', 'Config stored.', 2, [
        writeFileToolCall('tc-1', 'configs/nebula/runtime.json'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Next step', timestamp: 3 },
      closedAssistant('a-2', 'Continuing.', 4),
    ],
    turn3Query: 'configs/nebula/runtime.json',
    requiredStructuralTokens: ['configs/nebula/runtime.json', 'nebula'],
  },
  {
    id: 'recall-orion-dataset',
    threadId: 'conv-recall-orion',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Archive dataset', timestamp: 1 },
      closedAssistant('a-1', 'Dataset archived.', 2, [
        writeFileToolCall('tc-1', 'datasets/orion/train.csv'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Proceed', timestamp: 3 },
      closedAssistant('a-2', 'Proceeding.', 4),
    ],
    turn3Query: 'datasets/orion/train.csv',
    requiredStructuralTokens: ['datasets/orion/train.csv', 'orion'],
  },
  {
    id: 'recall-kestrel-report',
    threadId: 'conv-recall-kestrel',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Write analysis report', timestamp: 1 },
      closedAssistant('a-1', 'Report written.', 2, [
        writeFileToolCall('tc-1', 'reports/kestrel/q1-summary.md'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Continue', timestamp: 3 },
      closedAssistant('a-2', 'Continuing.', 4),
    ],
    turn3Query: 'reports/kestrel/q1-summary.md',
    requiredStructuralTokens: ['reports/kestrel/q1-summary.md', 'kestrel'],
  },
  {
    id: 'recall-vega-session',
    threadId: 'conv-recall-vega',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Record session output', timestamp: 1 },
      closedAssistant('a-1', 'Session output recorded.', 2, [
        writeFileToolCall('tc-1', 'sessions/vega/worker-vega-42/output.txt'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Follow up', timestamp: 3 },
      closedAssistant('a-2', 'Follow up complete.', 4),
    ],
    turn3Query: 'sessions/vega/worker-vega-42/output.txt',
    requiredStructuralTokens: ['sessions/vega/worker-vega-42/output.txt', 'worker-vega-42'],
  },
  {
    id: 'recall-lyra-artifact',
    threadId: 'conv-recall-lyra',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Store analysis artifact', timestamp: 1 },
      closedAssistant('a-1', 'Artifact stored.', 2, [
        writeFileToolCall('tc-1', 'artifacts/lyra/analysis-lyra-99.json'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Next', timestamp: 3 },
      closedAssistant('a-2', 'Next step done.', 4),
    ],
    turn3Query: 'artifacts/lyra/analysis-lyra-99.json',
    requiredStructuralTokens: ['artifacts/lyra/analysis-lyra-99.json', 'analysis-lyra-99'],
  },
  {
    id: 'recall-delta-manifest',
    threadId: 'conv-recall-delta',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Save manifest', timestamp: 1 },
      closedAssistant('a-1', 'Manifest saved.', 2, [
        writeFileToolCall('tc-1', 'manifests/delta/build-9001.json'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Continue build', timestamp: 3 },
      closedAssistant('a-2', 'Build continues.', 4),
    ],
    turn3Query: 'manifests/delta/build-9001.json',
    requiredStructuralTokens: ['manifests/delta/build-9001.json', 'build-9001'],
  },
  {
    id: 'recall-sigma-checkpoint',
    threadId: 'conv-recall-sigma',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Checkpoint state', timestamp: 1 },
      closedAssistant('a-1', 'Checkpoint saved.', 2, [
        writeFileToolCall('tc-1', 'state/sigma/checkpoint-17.bin'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Resume', timestamp: 3 },
      closedAssistant('a-2', 'Resumed.', 4),
    ],
    turn3Query: 'state/sigma/checkpoint-17.bin',
    requiredStructuralTokens: ['state/sigma/checkpoint-17.bin', 'checkpoint-17'],
  },
  {
    id: 'recall-aurora-logs',
    threadId: 'conv-recall-aurora',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Capture logs', timestamp: 1 },
      closedAssistant('a-1', 'Logs captured.', 2, [
        writeFileToolCall('tc-1', 'logs/aurora/deploy-2026-06-09.log'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Review', timestamp: 3 },
      closedAssistant('a-2', 'Reviewed.', 4),
    ],
    turn3Query: 'logs/aurora/deploy-2026-06-09.log',
    requiredStructuralTokens: ['logs/aurora/deploy-2026-06-09.log', 'aurora'],
  },
  {
    id: 'recall-comet-task-id',
    threadId: 'conv-recall-comet',
    turn1: [
      { id: 'u-1', role: 'user', content: 'Bind task id', timestamp: 1 },
      closedAssistant('a-1', 'Task bound.', 2, [
        writeFileToolCall('tc-1', 'tasks/comet/task-comet-771/task.json'),
      ]),
    ],
    turn2: [
      { id: 'u-2', role: 'user', content: 'Advance', timestamp: 3 },
      closedAssistant('a-2', 'Advanced.', 4),
    ],
    turn3Query: 'task-comet-771',
    requiredStructuralTokens: ['task-comet-771', 'comet'],
  },
];
