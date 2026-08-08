import { ToolDefinition } from '../../types/tool';

export const SESSION_SPAWN_TOOL: ToolDefinition = {
  name: 'sessions_spawn',
  description:
    'Launch a delegated worker for a self-contained task. The current run must first add a separate blocking goal owned by "delegated-worker" with requiredCapabilities including "coordinate" and successCriteria including "evidence.prefix:worker" plus "evidence.min:1"; do not repurpose a parent deliverable goal. Retry this tool with that goal id as workstreamId. By default the worker is joined to the current user request: the launch returns promptly, the supervisor should continue independent non-overlapping work, and it must obtain the terminal worker result before finalizing. Use waitForCompletion=true to also wait inside the launch call, or explicitly set false only when the worker should remain detached and control should return to the user immediately. Pass a focused prompt. The tools field is a strict security allowlist, not a task plan, and a worker given one receives exactly those tools with no discovery: name every tool its task requires. Omit it only when the default surface suffices, which it does not for code execution — the default carries no python or javascript, so a worker asked to compute can neither run nor discover them and will have no way to report why.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'Self-contained task instructions for the sub-agent. State the delegated job and the expected deliverable; keep it free of supervisor scratchpad text.',
      },
      workstreamId: {
        type: 'string',
        description:
          'Stable structured workstream id of the dedicated delegated-worker goal. In a current agent run, create that separate goal before spawning and pass its exact id here.',
      },
      goalScope: {
        type: 'object',
        description:
          'Read-only subset of parent graph goals that scope this worker. Goal ids must already exist on the supervisor run.',
        properties: {
          goalIds: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Goal ids from the parent run graph that this worker should focus on. When omitted, the sole eligible delegated-worker goal is used; multiple eligible goals require an exact workstreamId.',
          },
        },
      },
      dependsOnWorkstreams: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional prerequisite workstream ids or titles that must already be complete before this worker can start.',
      },
      name: {
        type: 'string',
        description: 'Optional short descriptive name for the worker.',
        maxLength: 256,
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional strict worker-tool security allowlist. Every omitted tool becomes unavailable. Usually omit this field; set it only when intentionally forbidding all other tools, after including every capability the complete task requires.',
      },
      waitForCompletion: {
        type: 'boolean',
        description:
          'Omit to launch promptly while keeping the worker joined to this request. Set true to wait for its result inside this tool call. Set false only to detach it and allow the supervisor turn to finish while it is still running.',
      },
    },
    required: ['prompt'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['coordinate'],
    resourceKinds: ['unknown'],
    sideEffects: ['external_run'],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
    produces: [{ kind: 'sub_agent_session' }],
    precedes: ['sessions_wait'],
  },
};

export const SESSION_LIST_TOOL: ToolDefinition = {
  name: 'sessions_list',
  description: 'List active and recent sub-agent sessions.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  contract: {
    category: 'sessions',
    capabilities: ['discover', 'read'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource'],
  },
};

export const SESSION_SEND_TOOL: ToolDefinition = {
  name: 'sessions_send',
  description:
    'Follow up on an existing sub-agent session. Use waitForCompletion=true when the current turn needs the follow-up result; otherwise detach it from this turn and return control immediately. Mobile operating systems may suspend background execution.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Target session ID' },
      message: { type: 'string', description: 'Message to send' },
      waitForCompletion: {
        type: 'boolean',
        description:
          'When true, wait for the follow-up worker result in this tool call instead of returning immediately with a running session id. Prefer false for substantial follow-up work.',
      },
      waitTimeoutMs: {
        type: 'number',
        description:
          'Optional maximum time to wait when waitForCompletion=true. If omitted, a 3-minute default wait window is used; if it elapses, the tool returns while the follow-up worker remains detached. Mobile operating systems may suspend its execution.',
      },
    },
    required: ['sessionId', 'message'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['coordinate', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['external_run'],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['continue_external_execution', 'verify_evidence'],
    produces: [{ kind: 'sub_agent_session' }],
    precedes: ['sessions_wait'],
  },
};

export const SESSION_HISTORY_TOOL: ToolDefinition = {
  name: 'sessions_history',
  description: 'Retrieve the transcript history from a sub-agent session.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to fetch history for' },
      maxMessages: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 50)',
      },
    },
    required: ['sessionId'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['read', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  },
};

export const SESSION_OUTPUT_TOOL: ToolDefinition = {
  name: 'sessions_output',
  description:
    'Retrieve the full final output from a terminal sub-agent session without its transcript history.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Terminal session ID whose final output should be returned.',
      },
    },
    required: ['sessionId'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['read', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['verify_evidence'],
  },
};

export const SESSION_SURFACE_OUTPUT_TOOL: ToolDefinition = {
  name: 'sessions_surface_output',
  description:
    'Surface final worker output directly as the visible assistant answer without retyping it. Optional prefix, suffix, or markers can narrow or wrap the surfaced section.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Terminal session ID whose final output should be surfaced to the user.',
      },
      prefix: {
        type: 'string',
        description:
          'Optional text inserted verbatim before the surfaced worker output, such as a short heading or framing sentence.',
      },
      suffix: {
        type: 'string',
        description:
          'Optional text inserted verbatim after the surfaced worker output, such as a short conclusion or next-step note.',
      },
      startMarker: {
        type: 'string',
        description:
          'Optional marker string that defines where the surfaced slice should start inside the worker output.',
      },
      endMarker: {
        type: 'string',
        description:
          'Optional marker string that defines where the surfaced slice should end inside the worker output.',
      },
      includeStartMarker: {
        type: 'boolean',
        description:
          'When true, include startMarker itself in the surfaced output. Defaults to false.',
      },
      includeEndMarker: {
        type: 'boolean',
        description:
          'When true, include endMarker itself in the surfaced output. Defaults to false.',
      },
      maxChars: {
        type: 'number',
        description:
          'Optional maximum number of worker-output characters to surface before prefix/suffix are applied.',
      },
      fallbackToFullOutput: {
        type: 'boolean',
        description:
          'When true or omitted, missing markers fall back to the full worker output. Set false to fail instead.',
      },
      trim: {
        type: 'boolean',
        description:
          'When true or omitted, trim leading and trailing whitespace from the selected worker output before wrapping it.',
      },
    },
    required: ['sessionId'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['read', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['verify_evidence'],
  },
};

export const SESSION_STATUS_TOOL: ToolDefinition = {
  name: 'sessions_status',
  description: 'Get the current live status of a sub-agent session.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to check' },
    },
    required: ['sessionId'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
    produces: [{ kind: 'sub_agent_session' }],
    precedes: ['sessions_wait'],
  },
};

export const SESSION_WAIT_TOOL: ToolDefinition = {
  name: 'sessions_wait',
  description:
    'Block until one or more sub-agent sessions reach terminal states and return their outputs. Provide sessionId for one worker, sessionIds for several workers, or omit both to wait for all currently running child sessions in the current conversation. Code-tracked workers joined to the current request are preferred when available. Otherwise copy IDs exactly from tool results; never reconstruct them.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Optional single session ID to wait for.' },
      sessionIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of exact session IDs to wait for together. Omit to wait for all workers joined to the current request, falling back to currently running child sessions when no joined worker is tracked.',
      },
      waitTimeoutMs: {
        type: 'number',
        description:
          'Optional maximum total time to wait. If omitted, a 3-minute default wait window is used. If it elapses, the tool returns running sessions as pending while they continue in the background.',
      },
    },
    required: [],
  },
  contract: {
    category: 'sessions',
    capabilities: ['wait', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['await_external_execution', 'verify_evidence'],
    consumes: [{ kind: 'sub_agent_session', required: false }],
  },
};

export const SESSION_CANCEL_TOOL: ToolDefinition = {
  name: 'sessions_cancel',
  description: 'Cancel a running sub-agent session.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Running session ID to cancel' },
      reason: {
        type: 'string',
        description: 'Optional short reason to record with the cancellation request.',
      },
    },
    required: ['sessionId'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['write', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['external_run'],
    riskHints: ['requires_approval'],
    providesEvidence: ['verification'],
    workflowStages: ['mutate_remote_state', 'verify_evidence'],
  },
};

export const SESSION_YIELD_TOOL: ToolDefinition = {
  name: 'sessions_yield',
  description: 'Record a supervisor checkpoint while sub-agents are running.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Optional short status message describing what the agent is waiting for.',
      },
    },
    required: [],
  },
  contract: {
    category: 'sessions',
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
  },
};

export const BUILTIN_SESSION_TOOL_DEFINITIONS: ToolDefinition[] = [
  SESSION_LIST_TOOL,
  SESSION_SEND_TOOL,
  SESSION_HISTORY_TOOL,
  SESSION_OUTPUT_TOOL,
  SESSION_SURFACE_OUTPUT_TOOL,
  SESSION_STATUS_TOOL,
  SESSION_WAIT_TOOL,
  SESSION_CANCEL_TOOL,
  SESSION_YIELD_TOOL,
];
