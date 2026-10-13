import { ToolDefinition } from '../../types/tool';
import { MEMORY_SEARCH_MAX_LIMIT } from '../../services/memory/core/memoryItemsTools';
import { MEMORY_ITEM_TEXT_MAX_CHARS } from '../../services/memory/core/memorySchema';

export const MEMORY_REMEMBER_TOOL: ToolDefinition = {
  name: 'memory_remember',
  description:
    'Save something to long-term memory so it can be used later: a fact, preference, plan, decision or detail about a person that the user shares or asks you to keep. ' +
    'Write one self-contained statement in the user\'s language that names who or what it is about, for example "Sara, the user\'s sister, lives in Porto". ' +
    'When it corrects or updates a memory shown under Memory or returned by memory_search, pass that memory id as replaces. ' +
    'Passwords, API keys and access tokens are never stored.',
  input_schema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        maxLength: MEMORY_ITEM_TEXT_MAX_CHARS,
        description: 'The statement to remember.',
      },
      replaces: {
        type: 'string',
        description: 'Id of the memory this statement corrects or updates.',
      },
      pinned: {
        type: 'boolean',
        description: 'Show this memory in every request, not only when it matches.',
      },
      sensitive: {
        type: 'boolean',
        description:
          'Health, finances or other private details: kept out of the automatic Memory section and shown only when searched for.',
      },
    },
    required: ['content'],
    additionalProperties: false,
  },
  contract: {
    category: 'memory',
    capabilities: ['write'],
    resourceKinds: ['memory'],
    sideEffects: ['local_artifact'],
    riskHints: ['idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  },
};

export const MEMORY_SEARCH_TOOL: ToolDefinition = {
  name: 'memory_search',
  description:
    'Search long-term memory and earlier conversations. Use it when the Memory section does not already answer the request, for a sensitive memory, or to find the id of a memory to correct or forget. ' +
    'Returns matching memories with their ids and dates, and matching exchanges from earlier conversations.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for, in any language.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MEMORY_SEARCH_MAX_LIMIT,
        description: 'Maximum memories to return (default 8).',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  contract: {
    category: 'memory',
    capabilities: ['discover', 'read'],
    resourceKinds: ['memory'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: [],
  },
};

export const MEMORY_FORGET_TOOL: ToolDefinition = {
  name: 'memory_forget',
  description:
    'Delete a memory permanently when the user asks you to forget it, together with the older versions it replaced. ' +
    'Pass the id shown under Memory or returned by memory_search. To correct a memory instead, use memory_remember with replaces.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id of the memory to delete.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  contract: {
    category: 'memory',
    capabilities: ['delete'],
    resourceKinds: ['memory'],
    sideEffects: ['destructive'],
    riskHints: ['destructive', 'requires_approval'],
    riskLevel: 'high',
    providesEvidence: ['verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  },
};

export const BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS: ToolDefinition[] = [
  MEMORY_REMEMBER_TOOL,
  MEMORY_SEARCH_TOOL,
  MEMORY_FORGET_TOOL,
];
