import { ToolDefinition } from '../../types/tool';

export const MEMORY_SEARCH_TOOL: ToolDefinition = {
  name: 'memory_search',
  description:
    'Search the structured living-memory fact store for conversation memory, global memory, or both. ' +
    'Results label which scope each match came from and cite the fact/source record used as evidence. ' +
    'This discovery tool never exposes sensitive or restricted facts.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      scope: {
        type: 'string',
        enum: ['all', 'conversation', 'global'],
        description: 'Which memory scope to search. Default: "all".',
      },
      maxResults: { type: 'number', description: 'Maximum results to return (default: 10)' },
    },
    required: ['query'],
  },
  contract: {
    category: 'memory_search',
    capabilities: ['discover', 'read'],
    resourceKinds: ['memory'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: [],
  },
};

export const MEMORY_RECALL_TOOL: ToolDefinition = {
  name: 'memory_recall',
  description:
    'Recall structured facts from the living-memory fact store. Filter by subject (entity name), predicate (relation), or pinnedOnly. ' +
    'Returns only facts authorized for the exact current owner, workspace, thread, persona, and task. Each result has a binding use, ask, or abstain policy. ' +
    'Sensitive facts require the current user message to request one exact subject and predicate; broad or model-initiated recall cannot expose them. Restricted facts are never returned. ' +
    'Use this when you need exact, structured recall of what is known about a subject; use memory_search when the subject or predicate is not known yet. ' +
    'If recall supports a same-turn request to write, create, send, update, open, or otherwise act, continue to the action tool with the recalled facts before final delivery.',
  input_schema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Entity name to filter by (e.g. "user", "project-x").',
      },
      predicate: {
        type: 'string',
        description: 'Relation/predicate to filter by (e.g. "prefers", "deadline").',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'conversation', 'session', 'persona'],
        description: 'Optional fact scope filter.',
      },
      all: {
        type: 'boolean',
        description: 'When true, list all valid facts without another filter.',
      },
      pinnedOnly: { type: 'boolean', description: 'Return only pinned facts.' },
      limit: { type: 'number', description: 'Max facts to return (default 50, hard cap 50).' },
    },
    required: [],
    additionalProperties: false,
  },
  contract: {
    category: 'memory_search',
    capabilities: ['discover', 'read'],
    resourceKinds: ['memory'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: [],
  },
};

export const MEMORY_REMEMBER_TOOL: ToolDefinition = {
  name: 'memory_remember',
  description:
    'Record a structured fact (subject, predicate, value) in the living-memory fact store. ' +
    'Preserve user-supplied subject, predicate, and value labels exactly, especially opaque ids, snake_case predicates, codes, contact names, and tokens; do not rename predicates or translate values. ' +
    'For an I/my/me statement, use subject "user" with subjectType "self"; never put the preference topic in the subject field. Self candidates are canonicalized to "user" only after one code-owned, unquoted, non-negated current-user clause binds the user, proposed relation, and exact value. A non-user fact requires the exact subject label and value in the code-owned current user message. Otherwise the write fails without changing current memory. Use distinct subjects or predicates for parallel valid values. ' +
    'Use a high confidence (≥ 0.85) only when you have direct user confirmation; otherwise leave confidence at the default to mark the fact as a candidate.',
  input_schema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Exact entity label supplied by the user (e.g. "user", "project-x").',
      },
      subjectType: {
        type: 'string',
        enum: ['self', 'person', 'project', 'concept', 'system'],
        description:
          'Use "self" only for an I/my/me fact and pair it with subject "user"; otherwise use the actual entity type.',
      },
      predicate: {
        type: 'string',
        description:
          'Exact relation/predicate label supplied by the user; preserve opaque and snake_case labels.',
      },
      value: {
        type: 'string',
        description:
          'Exact object text/value supplied by the user (≤ 200 chars); preserve opaque labels, codes, tokens, and contact names.',
      },
      confidence: {
        type: 'number',
        description: '0..1 confidence estimate; review state and evidence authority are separate.',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'conversation', 'session', 'persona'],
        description: 'Where this fact belongs. Use global only for stable profile/preferences.',
      },
      sourceSummary: { type: 'string', description: 'Short evidence note or reason.' },
      importance: { type: 'number', description: '0..1 importance used for recall and decay.' },
      pinned: {
        type: 'boolean',
        description: 'Pin the new fact so it always appears in the focus header.',
      },
    },
    required: ['subject', 'predicate', 'value', 'scope'],
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

export const MEMORY_PIN_TOOL: ToolDefinition = {
  name: 'memory_pin',
  description:
    'Pin a fact by id so it is always included in the focus header surfaced to the model.',
  input_schema: {
    type: 'object',
    properties: {
      factId: { type: 'string', description: 'ID returned by memory_recall or memory_remember.' },
    },
    required: ['factId'],
  },
};

export const MEMORY_UNPIN_TOOL: ToolDefinition = {
  name: 'memory_unpin',
  description:
    'Remove a pin from a fact so it competes with other facts for focus-header inclusion.',
  input_schema: {
    type: 'object',
    properties: { factId: { type: 'string' } },
    required: ['factId'],
  },
};

export const MEMORY_FORGET_TOOL: ToolDefinition = {
  name: 'memory_forget',
  description:
    'Permanently withdraw a fact when the user explicitly asks for it to be forgotten or removed. ' +
    'Withdrawal removes the fact and its authoritative derived memory while retaining only a content-free audit receipt. ' +
    'For a correction, record the replacement with memory_remember or use memory_manage action=invalidate; do not withdraw it.',
  input_schema: {
    type: 'object',
    properties: {
      factId: { type: 'string' },
    },
    required: ['factId'],
    additionalProperties: false,
  },
  contract: {
    category: 'memory',
    capabilities: ['write'],
    resourceKinds: ['memory'],
    sideEffects: ['destructive'],
    riskHints: ['destructive', 'requires_approval'],
    riskLevel: 'high',
    providesEvidence: ['verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
  },
};

export const MEMORY_MANAGE_TOOL: ToolDefinition = {
  name: 'memory_manage',
  description:
    'Manage a fact by id. ' +
    'Use action=pin to keep a fact in the focus header, action=unpin to release it, ' +
    'or action=invalidate to close an incorrect fact while preserving audit history. ' +
    'Explicit withdrawal is available only through memory_forget.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['pin', 'unpin', 'invalidate'],
        description: 'Operation to perform.',
      },
      factId: { type: 'string', description: 'ID returned by memory_recall or memory_remember.' },
    },
    required: ['action', 'factId'],
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

export const MEMORY_BLOCK_READ_TOOL: ToolDefinition = {
  name: 'memory_block_read',
  description:
    'Read one or all editable memory blocks. Blocks are short, model-editable scratch surfaces (persona, scratchpad, etc.) that always appear in the focus header. Omit label to list all blocks.',
  input_schema: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'Block label (e.g. "persona", "scratchpad"). Omit to list all blocks.',
      },
    },
    required: [],
  },
};

export const MEMORY_BLOCK_EDIT_TOOL: ToolDefinition = {
  name: 'memory_block_edit',
  description:
    'Edit a memory block. With replace=true (default) the block content is overwritten; with replace=false the new content is appended on a new line. Block content is truncated at the block char limit.',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      content: { type: 'string' },
      replace: { type: 'boolean', description: 'Default true (overwrite).' },
    },
    required: ['label', 'content'],
  },
};

export const MEMORY_BLOCK_TOOL: ToolDefinition = {
  name: 'memory_block',
  description:
    'Read or edit an editable memory block. ' +
    'Use action=read (omit label to list all blocks) to fetch block contents, ' +
    'or action=edit to overwrite (replace=true, default) or append (replace=false) content.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'edit'],
        description: 'Operation to perform.',
      },
      label: {
        type: 'string',
        description:
          'Block label (e.g. "persona", "scratchpad"). Required for action=edit; optional for action=read.',
      },
      content: { type: 'string', description: 'New content. Required for action=edit.' },
      replace: {
        type: 'boolean',
        description: 'For action=edit: true (default) overwrites, false appends on a new line.',
      },
    },
    required: ['action'],
  },
  contract: {
    category: 'memory_block',
    capabilities: ['read', 'write'],
    resourceKinds: ['memory_block'],
    sideEffects: ['local_artifact'],
    riskHints: ['idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'persist_artifact', 'verify_evidence'],
  },
};

export const BUILTIN_MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
  MEMORY_SEARCH_TOOL,
  MEMORY_RECALL_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_PIN_TOOL,
  MEMORY_UNPIN_TOOL,
  MEMORY_FORGET_TOOL,
  MEMORY_MANAGE_TOOL,
  MEMORY_BLOCK_READ_TOOL,
  MEMORY_BLOCK_EDIT_TOOL,
  MEMORY_BLOCK_TOOL,
];

export const BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS: ToolDefinition[] = [
  MEMORY_SEARCH_TOOL,
  MEMORY_RECALL_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_FORGET_TOOL,
  MEMORY_MANAGE_TOOL,
  MEMORY_BLOCK_TOOL,
];
