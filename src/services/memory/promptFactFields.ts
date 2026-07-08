import type { MemoryFactKind } from './facts/types';

export function promptFieldsForMemoryKind(kind: MemoryFactKind): ReadonlyArray<string> | null {
  switch (kind) {
    case 'agent_run':
      return [
        'sourceRunId',
        'goal',
        'status',
        'outcome',
        'tools',
        'sources',
        'artifacts',
        'decisions',
        'risks',
        'summaries',
        'evidenceSlices',
      ];
    case 'goal':
      return ['goal', 'status', 'sourceRunId'];
    case 'tool_result':
    case 'gotcha':
      return [
        'sourceRunId',
        'goal',
        'status',
        'outcome',
        'tools',
        'sources',
        'artifacts',
        'decisions',
        'risks',
        'summaries',
      ];
    case 'decision':
      return ['decision', 'status', 'reason', 'sourceRunId'];
    case 'risk':
      return ['risk', 'status', 'mitigation', 'sourceRunId'];
    case 'artifact':
      return ['artifact', 'path', 'url', 'summary', 'sourceRunId'];
    case 'source':
      return ['source', 'url', 'title', 'summary', 'sourceRunId'];
    case 'summary':
      return ['summary', 'sourceRunId'];
    default:
      return null;
  }
}
