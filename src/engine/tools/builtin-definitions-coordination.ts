import { ToolDefinition } from '../../types/tool';
import { TOOL_CATALOG_AVAILABLE_CATEGORIES } from './builtin-tool-catalogConfig';

export const TOOL_CATALOG_TOOL: ToolDefinition = {
  name: 'tool_catalog',
  description:
    'Discover tools from the mobile catalog. Prefer query and/or capabilities for a natural-language intent or when multiple resource domains could apply. Use category only when the target resource domain is explicit. Use the empty overview call only to inspect categories first.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description:
          'Optional exact resource-domain filter from the declared enum. Automation is for recurring or deferred assistant tasks and cron jobs; calendar is only for device calendar events; notifications is only for user alerts. Prefer query when the domain is uncertain.',
        enum: TOOL_CATALOG_AVAILABLE_CATEGORIES,
      },
      query: {
        type: 'string',
        description:
          'Optional structural search query. Tokens are matched against tool names, categories, capabilities, and MCP server identifiers.',
      },
      capabilities: {
        type: 'array',
        description:
          'Optional capability hints for the needed workflow. Example: ["read", "verify"].',
        items: {
          type: 'string',
          enum: [
            'discover',
            'read',
            'write',
            'commit',
            'push',
            'deploy',
            'monitor',
            'wait',
            'verify',
            'coordinate',
            'compute',
          ],
        },
      },
    },
    required: [],
  },
  contract: {
    category: 'tools',
    capabilities: ['discover'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: [],
    workflowStages: [],
  },
};

export const TOOL_DESCRIBE_TOOL: ToolDefinition = {
  name: 'tool_describe',
  description:
    'Return the full contract and input schema for one tool by name. Use after catalog search when you need the exact invocation shape.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Exact tool name to describe.',
      },
    },
    required: ['name'],
  },
  contract: {
    category: 'tools',
    capabilities: ['discover'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: [],
    workflowStages: [],
  },
};

export const POLL_CREATE_TOOL: ToolDefinition = {
  name: 'poll_create',
  description:
    'Create an interactive decision poll inside the conversation so the user can choose between options.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Poll question shown to the user' },
      options: {
        type: 'array',
        description: 'List of poll option labels',
        items: { type: 'string' },
      },
      allowMultiple: {
        type: 'boolean',
        description: 'Allow selecting multiple options (default: false)',
      },
      durationMs: {
        type: 'number',
        description: 'Optional suggested duration in milliseconds',
      },
    },
    required: ['question', 'options'],
  },
  contract: {
    category: 'interaction',
    capabilities: ['coordinate'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['verify_evidence'],
  },
};

export const SPEAK_TOOL: ToolDefinition = {
  name: 'speak',
  description:
    'Speak text aloud using text-to-speech. Supports system, OpenAI, and ElevenLabs TTS backends.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to speak' },
      provider: {
        type: 'string',
        description: 'TTS provider: system, openai, or elevenlabs (default: system)',
      },
    },
    required: ['text'],
  },
  contract: {
    category: 'interaction',
    capabilities: ['coordinate'],
    resourceKinds: ['device'],
    sideEffects: ['none'],
    riskHints: ['idempotent'],
    providesEvidence: [],
    workflowStages: [],
  },
};

export const AGENTS_LIST_TOOL: ToolDefinition = {
  name: 'agents_list',
  description: 'List all available agent personas and their capabilities.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const AGENTS_SWITCH_TOOL: ToolDefinition = {
  name: 'agents_switch',
  description: 'Switch the active agent persona. Changes system prompt and model routing.',
  input_schema: {
    type: 'object',
    properties: {
      personaId: { type: 'string', description: 'ID of the persona to activate' },
    },
    required: ['personaId'],
  },
};

export const AGENTS_CONFIGURE_TOOL: ToolDefinition = {
  name: 'agents_configure',
  description:
    "Configure an agent persona's properties like name, model, system prompt, or temperature.",
  input_schema: {
    type: 'object',
    properties: {
      personaId: { type: 'string', description: 'ID of the persona to configure' },
      name: { type: 'string', description: 'New display name (optional)' },
      description: { type: 'string', description: 'New description (optional)' },
      model: { type: 'string', description: 'Model override (optional)' },
      providerId: { type: 'string', description: 'Provider override (optional)' },
      systemPrompt: { type: 'string', description: 'Custom system prompt (optional)' },
      temperature: { type: 'number', description: 'Temperature 0-2 (optional)' },
      thinkingLevel: {
        type: 'string',
        description: 'Thinking level override: off, low, medium, or high (optional)',
      },
    },
    required: ['personaId'],
  },
};

export const AGENTS_TOOL: ToolDefinition = {
  name: 'agents',
  description:
    'Manage agent personas. ' +
    'Use action=list to enumerate available personas, action=switch to activate a persona by id, ' +
    'or action=configure to update name/model/systemPrompt/temperature/thinkingLevel. ' +
    'This does not delegate work; use session tools for sub-agent workstreams.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'switch', 'configure'],
        description: 'Operation to perform.',
      },
      personaId: {
        type: 'string',
        description: 'Persona id. Required for action=switch and action=configure.',
      },
      name: { type: 'string', description: 'New display name (action=configure).' },
      description: { type: 'string', description: 'New description (action=configure).' },
      model: { type: 'string', description: 'Model override (action=configure).' },
      providerId: { type: 'string', description: 'Provider override (action=configure).' },
      systemPrompt: { type: 'string', description: 'Custom system prompt (action=configure).' },
      temperature: { type: 'number', description: 'Temperature 0-2 (action=configure).' },
      thinkingLevel: {
        type: 'string',
        description: 'Thinking level override: off, low, medium, or high (action=configure).',
      },
    },
    required: ['action'],
  },
  contract: {
    category: 'agents',
    capabilities: ['discover'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'verify_evidence'],
  },
};

export const BUILTIN_COORDINATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  TOOL_CATALOG_TOOL,
  TOOL_DESCRIBE_TOOL,
  POLL_CREATE_TOOL,
  SPEAK_TOOL,
  AGENTS_TOOL,
];
