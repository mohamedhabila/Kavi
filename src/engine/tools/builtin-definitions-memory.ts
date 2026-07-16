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
    'Sensitive facts require explicitRequestEvidence copied from one exact current-user request for the same subject and predicate. The canonical predicate may differ from the natural relation_quote; product code binds both to the exact request. Broad or model-initiated recall cannot expose sensitive facts. Restricted facts are never returned. ' +
    'Use this when you need exact, structured recall of what is known about a subject; use memory_search when the subject or predicate is not known yet. ' +
    'If recall supports a same-turn request to write, create, send, update, open, or otherwise act, continue to the action tool with the recalled facts before final delivery.',
  input_schema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description:
          'Exact entity label to filter by (for the current user, use "user"). A phrase describing the fact is not a subject; put a known relation in predicate or use memory_search when the entity label is unknown.',
      },
      predicate: {
        type: 'string',
        description: 'Relation/predicate to filter by (e.g. "prefers", "deadline").',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'conversation', 'session', 'persona'],
        description:
          'Optional exact stored-scope filter. Omit it when the stored scope is not already known; ordinary user preferences may be global or bound to the active persona.',
      },
      all: {
        type: 'boolean',
        description: 'When true, list all valid facts without another filter.',
      },
      pinnedOnly: { type: 'boolean', description: 'Return only pinned facts.' },
      limit: { type: 'number', description: 'Max facts to return (default 50, hard cap 50).' },
      explicitRequestEvidence: {
        type: 'object',
        description:
          'Strict typed evidence for a current-user request to expose one exact sensitive subject and predicate. Omit for ordinary recall.',
        additionalProperties: false,
        properties: {
          version: { type: 'number', enum: [1] },
          source_message_id: { type: 'string', minLength: 1, maxLength: 120 },
          evidence_quote: { type: 'string', minLength: 1, maxLength: 600 },
          subject_ref: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { type: 'string', enum: ['self'] } },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['named'] },
                  label: { type: 'string', minLength: 1, maxLength: 80 },
                },
                required: ['kind', 'label'],
                additionalProperties: false,
              },
            ],
          },
          subject_quote: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
            description: 'Exact subject mention copied from evidence_quote.',
          },
          predicate: { type: 'string', minLength: 1, maxLength: 80 },
          relation_quote: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'Exact natural-language relation/request phrase copied from evidence_quote; it need not equal the canonical predicate.',
          },
        },
        required: [
          'version',
          'source_message_id',
          'evidence_quote',
          'subject_ref',
          'subject_quote',
          'predicate',
          'relation_quote',
        ],
      },
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
    'Record one structured fact using strict provider-neutral semantic evidence. ' +
    'semanticEvidence is untrusted model output: declare the typed fact and copy value as the smallest atomic exact substring that remains current. Include only the semantic object; exclude the subject, relation wording, assertion/correction wording, and every superseded alternative. Never paraphrase, normalize, or change grammatical person. Keep any named subject label verbatim. Use subject.kind=self with no other subject fields when the current user is the subject. A named subject requires its exact label and semantic entity type in the same subject object. The runtime owns the current user message and derives the shortest bounded exact span containing those strings; never copy or paraphrase an evidence quote. Predicate is a semantic relation rather than a verbatim quote. ' +
    'For a present direct assertion in the current user message, use assertion_class=current_direct. current_direct describes the source timing and authority, not the subject identity: it is valid for either subject.kind=self or an exactly named subject directly asserted by the user. Do not reinterpret an exact named subject as the current user or request identity confirmation merely because the subject is named. A successful code-owned read or verification tool result from this same execution run may also authorize one exact named-subject fact: keep the named subject and value verbatim, use assertion_class=quoted, operation=record, and prefer scope project, conversation, or session. The runtime accepts only an unambiguous exact source span from a reviewed effect-free tool; it derives the actual source authority itself and narrows any over-broad tool-observed scope to project. Dynamic tools, failed/compacted outputs, self facts, and tool-observed replacements remain unauthorized. Historical, hypothetical, third-party, and uncertain content has no write authority. ' +
    'Use operation=record only when no current fact exists for the exact subject, predicate, and scope; use replace_current only to replace exactly one current fact. ' +
    'Code binds the evidence to the current message, owner scope, execution claim, and replay identity before any write.',
  input_schema: {
    type: 'object',
    properties: {
      semanticEvidence: {
        type: 'object',
        additionalProperties: false,
        properties: {
          version: { type: 'number', enum: [4] },
          subject: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { type: 'string', enum: ['self'] } },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['named'] },
                  label: { type: 'string', minLength: 1, maxLength: 80 },
                  type: {
                    type: 'string',
                    enum: ['person', 'place', 'org', 'project', 'thing', 'concept', 'event'],
                  },
                },
                required: ['kind', 'label', 'type'],
                additionalProperties: false,
              },
            ],
          },
          predicate: { type: 'string', minLength: 1, maxLength: 80 },
          value: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
              'Smallest atomic exact value copied verbatim from the current user message or one authorized verified read result. Include only the semantic object that remains current; exclude surrounding assertion or correction wording and all superseded alternatives.',
          },
          scope: {
            type: 'string',
            enum: ['global', 'project', 'conversation', 'session', 'persona'],
            description:
              'Choose scope from intended durability and code-owned active context, never from ordinal or section labels in the message. When the user explicitly asks to remember a fact without limiting its context, prefer global. Use persona only when the fact intentionally applies to the active persona alone. Use project or conversation only for correspondingly bounded context. Use session only for an active user task; it is invalid when no task identity exists.',
          },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          operation: { type: 'string', enum: ['record', 'replace_current'] },
          assertion_class: {
            type: 'string',
            enum: [
              'current_direct',
              'historical',
              'hypothetical',
              'quoted',
              'third_party',
              'uncertain',
            ],
          },
          sensitivity: {
            type: 'string',
            enum: ['normal', 'personal', 'sensitive', 'restricted'],
          },
        },
        required: [
          'version',
          'subject',
          'predicate',
          'value',
          'scope',
          'importance',
          'confidence',
          'operation',
          'assertion_class',
          'sensitivity',
        ],
      },
      pinned: {
        type: 'boolean',
        description: 'Pin the new fact so it always appears in the focus header.',
      },
    },
    required: ['semanticEvidence'],
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
    capabilities: ['delete'],
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

export const BUILTIN_MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
  MEMORY_SEARCH_TOOL,
  MEMORY_RECALL_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_PIN_TOOL,
  MEMORY_UNPIN_TOOL,
  MEMORY_FORGET_TOOL,
  MEMORY_MANAGE_TOOL,
];

export const BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS: ToolDefinition[] = [
  MEMORY_SEARCH_TOOL,
  MEMORY_RECALL_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_FORGET_TOOL,
  MEMORY_MANAGE_TOOL,
];
