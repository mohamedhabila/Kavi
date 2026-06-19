// ---------------------------------------------------------------------------
// Kavi — Tool catalog discovery fixtures (structural)
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';

export interface ToolCatalogDiscoveryFixture {
  id: string;
  allTools: ReadonlyArray<ToolDefinition>;
  workingMessages: ReadonlyArray<Message>;
  expectedActivatedTools: ReadonlyArray<string>;
  expectDiscoveryToolsAbsent?: boolean;
}

const DISCOVERY_CATALOG: ReadonlyArray<ToolDefinition> = [
  {
    name: 'read_file',
    description: 'Read workspace file.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'workspace_files',
      capabilities: ['read', 'verify'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall memory facts.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'memory',
      capabilities: ['read', 'verify'],
      resourceKinds: ['memory'],
    },
  },
  {
    name: 'memory_remember',
    description: 'Store memory facts.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'memory',
      capabilities: ['write', 'verify'],
      resourceKinds: ['memory'],
    },
  },
  {
    name: 'tool_catalog',
    description: 'Discover tools.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'tools',
      capabilities: ['discover'],
      resourceKinds: ['unknown'],
    },
  },
  {
    name: 'tool_describe',
    description: 'Describe one tool.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'tools',
      capabilities: ['discover'],
      resourceKinds: ['unknown'],
    },
  },
];

export const TOOL_CATALOG_DISCOVERY_FIXTURES: ReadonlyArray<ToolCatalogDiscoveryFixture> = [
  {
    id: 'catalog-search-activates-memory-recall',
    allTools: DISCOVERY_CATALOG,
    workingMessages: [
      { id: 'user-1', role: 'user', content: 'Find memory recall tooling.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-search',
            name: 'tool_catalog',
            arguments: '{"query":"memory_recall","capabilities":["read"]}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({
          mode: 'search',
          query: 'memory_recall',
          capabilities: ['read'],
          tools: [{ name: 'memory_recall' }],
          totalMatches: 1,
        }),
        toolCallId: 'tc-search',
        timestamp: 3,
      },
    ],
    expectedActivatedTools: ['memory_recall'],
  },
  {
    id: 'tool-describe-activates-target',
    allTools: DISCOVERY_CATALOG,
    workingMessages: [
      { id: 'user-1', role: 'user', content: 'Describe memory recall.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-describe',
            name: 'tool_describe',
            arguments: '{"name":"memory_recall"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({
          mode: 'describe',
          tool: {
            name: 'memory_recall',
            description: 'Recall memory facts.',
            contract: { capabilities: ['read', 'verify'] },
          },
        }),
        toolCallId: 'tc-describe',
        timestamp: 3,
      },
    ],
    expectedActivatedTools: ['memory_recall'],
  },
];
