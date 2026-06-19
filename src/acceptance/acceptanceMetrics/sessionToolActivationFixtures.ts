// ---------------------------------------------------------------------------
// Kavi — Session tool activation fixtures (structural)
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';

export interface SessionToolActivationFixture {
  id: string;
  allTools: ReadonlyArray<ToolDefinition>;
  sessionActivatedToolNames: ReadonlyArray<string>;
  workingMessages: ReadonlyArray<Message>;
  expectedActivatedTools: ReadonlyArray<string>;
  expectDiscoveryToolsAbsent?: boolean;
}

const SESSION_ACTIVATION_CATALOG: ReadonlyArray<ToolDefinition> = [
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
    name: 'pdf_read',
    description: 'Read a PDF document.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'documents',
      capabilities: ['read', 'verify'],
      resourceKinds: ['document'],
      sideEffects: ['none'],
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

export const SESSION_TOOL_ACTIVATION_FIXTURES: ReadonlyArray<SessionToolActivationFixture> = [
  {
    id: 'session-cache-retains-catalog-search-across-user-turn',
    allTools: SESSION_ACTIVATION_CATALOG,
    sessionActivatedToolNames: ['pdf_read'],
    workingMessages: [
      { id: 'user-1', role: 'user', content: 'Find PDF reading tooling.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-search',
            name: 'tool_catalog',
            arguments: '{"query":"pdf_read","capabilities":["read"]}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({
          mode: 'search',
          query: 'pdf_read',
          tools: [{ name: 'pdf_read' }],
        }),
        toolCallId: 'tc-search',
        timestamp: 3,
      },
      { id: 'user-2', role: 'user', content: 'Read the PDF now.', timestamp: 4 },
    ],
    expectedActivatedTools: ['pdf_read'],
  },
  {
    id: 'session-cache-retains-describe-across-user-turn',
    allTools: SESSION_ACTIVATION_CATALOG,
    sessionActivatedToolNames: ['pdf_read'],
    workingMessages: [
      { id: 'user-1', role: 'user', content: 'Describe PDF reading.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-describe',
            name: 'tool_describe',
            arguments: '{"name":"pdf_read"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({
          mode: 'describe',
          tool: { name: 'pdf_read' },
        }),
        toolCallId: 'tc-describe',
        timestamp: 3,
      },
      { id: 'user-2', role: 'user', content: 'Open the PDF details.', timestamp: 4 },
    ],
    expectedActivatedTools: ['pdf_read'],
  },
  {
    id: 'without-session-cache-new-user-turn-drops-catalog-activation',
    allTools: SESSION_ACTIVATION_CATALOG,
    sessionActivatedToolNames: [],
    workingMessages: [
      { id: 'user-1', role: 'user', content: 'Find PDF reading tooling.', timestamp: 1 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-search',
            name: 'tool_catalog',
            arguments: '{"query":"pdf_read"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: JSON.stringify({
          mode: 'search',
          query: 'pdf_read',
          tools: [{ name: 'pdf_read' }],
        }),
        toolCallId: 'tc-search',
        timestamp: 3,
      },
      { id: 'user-2', role: 'user', content: 'Use the PDF reader now.', timestamp: 4 },
    ],
    expectedActivatedTools: [],
  },
];
