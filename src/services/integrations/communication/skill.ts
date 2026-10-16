import type { Skill, SkillToolDefinition } from '../../skills/types';
import { secretRuntimeRequirement } from '../../../types/tool';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../types/toolRuntimeOutcome';
import {
  AGENT_CALL_LIMITS,
  AgentCallArgumentError,
  MAX_CALL_MINUTES,
  planAgentCall,
} from './agentCallRequest';
import { followAgentCall, MAX_WAIT_SECONDS, waitSecondsFrom } from './agentCallStatus';
import {
  BLAND_API_KEY_SECRET,
  BlandError,
  queueBlandCall,
  stopBlandCall,
  type BlandErrorKind,
} from './blandClient';

type FailureKind = Extract<ToolRuntimeOutcome, { status: 'failed' }>['failureKind'];

const STATUS_TOOL = 'skill__communication__agent_call_status';

// Every tool calls Bland with the person's own key, so none is offered before it is set.
const BLAND_REQUIREMENT = secretRuntimeRequirement(BLAND_API_KEY_SECRET);

/** What Kavi tells the model to do about each Bland failure. */
const FAILURES: Readonly<
  Record<BlandErrorKind, { status: string; kind: FailureKind; next: string }>
> = {
  not_configured: {
    status: 'not_configured',
    kind: 'unavailable',
    next: 'Use setup_guide with topic phone_calls to walk the person through getting a Bland key.',
  },
  auth: {
    status: 'auth_failed',
    kind: 'auth',
    next: 'The key in Settings is wrong or revoked: use setup_guide with topic phone_calls to have the person enter it again.',
  },
  billing: {
    status: 'needs_credit',
    kind: 'permission',
    next: 'Ask the person to add credit at app.bland.ai (at least $5), then try again.',
  },
  rate_limited: {
    status: 'rate_limited',
    kind: 'rate_limited',
    next: 'Wait at least 10 seconds before calling the same number again; if it persists, the daily call cap is reached.',
  },
  invalid_request: {
    status: 'invalid_request',
    kind: 'invalid_arguments',
    next: 'Fix what Bland named and try again.',
  },
  blocked: {
    status: 'blocked',
    kind: 'permission',
    next: 'Bland refused this account or number; the person can check the account at app.bland.ai.',
  },
  not_found: {
    status: 'not_found',
    kind: 'not_found',
    next: 'Check the callId from the call that was started.',
  },
  provider: {
    status: 'provider_error',
    kind: 'provider',
    next: 'Bland had a problem; try again in a minute.',
  },
  network: {
    status: 'network_error',
    kind: 'network',
    next: 'Check the connection and try again.',
  },
  timeout: { status: 'timeout', kind: 'timeout', next: 'Try again in a moment.' },
};

function json(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function failure(error: unknown): ToolRuntimeOutcome {
  if (error instanceof BlandError) {
    const { status, kind, next } = FAILURES[error.kind];
    return failedToolOutcome(json({ status, error: error.message, next }), kind);
  }
  return failedToolOutcome(
    json({ status: 'failed', error: error instanceof Error ? error.message : String(error) }),
    'internal',
  );
}

function callIdFrom(args: Record<string, unknown>): string | undefined {
  const id = typeof args.callId === 'string' ? args.callId.trim() : '';
  return /^[A-Za-z0-9-]{8,64}$/u.test(id) ? id : undefined;
}

const AGENT_CALL_TOOL: SkillToolDefinition = {
  name: 'agent_call',
  description:
    'Have Kavi itself talk on a phone call for the person, through Bland, a calling service: ' +
    'book a table, ask about opening hours, prices or availability, reschedule, follow up. ' +
    'Unlike phone_call (the person talks on their own phone), Kavi speaks and listens, from a ' +
    'Bland number, at the cost of the person’s Bland account (about $0.14 a minute). The ' +
    'callee first hears that Kavi is an AI assistant calling for the person and that the ' +
    'call is recorded. Call businesses; call a private person only when the person says that ' +
    'contact agreed to a call from an AI. Never call emergency numbers. The person approves ' +
    'the number, the opening and what may be shared. Returns a callId at once: follow the ' +
    `call with ${STATUS_TOOL}, then tell the person what was said and agreed.`,
  input_schema: {
    type: 'object',
    properties: {
      phoneNumber: { type: 'string', description: 'The number to call' },
      defaultCountry: {
        type: 'string',
        description: 'Optional two-letter ISO country code for a local number',
      },
      callerName: {
        type: 'string',
        maxLength: AGENT_CALL_LIMITS.callerName,
        description: "The person's first name, which Kavi says it is calling for",
      },
      language: {
        type: 'string',
        description:
          'The language to speak on the call, as a BCP-47 tag (en-US, fr, es-419, ja); the callee’s language, not necessarily the person’s. Bland has no Arabic voice of its own: Arabic calls rely on its automatic language detection',
      },
      opening: {
        type: 'string',
        maxLength: AGENT_CALL_LIMITS.opening,
        description:
          'What Kavi says right after introducing itself, in the call\'s language, e.g. "I\'d like to book a table for two tonight at 8."',
      },
      goal: {
        type: 'string',
        maxLength: AGENT_CALL_LIMITS.goal,
        description:
          'What the call must achieve and find out, and which alternatives are acceptable (e.g. "any time 7:30–9 pm; otherwise ask what is free tomorrow")',
      },
      mayShare: {
        type: 'string',
        maxLength: AGENT_CALL_LIMITS.mayShare,
        description:
          'Facts Kavi may give on the call (name for the booking, party size, a booking reference, a callback number); nothing else is shared',
      },
      maxMinutes: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_CALL_MINUTES,
        description: `Longest the call may last, 1 to ${MAX_CALL_MINUTES} minutes (default 5)`,
      },
      voicemailMessage: {
        type: 'string',
        maxLength: AGENT_CALL_LIMITS.voicemailMessage,
        description:
          "Optional message to leave on voicemail, in the call's language; without it Kavi hangs up on voicemail",
      },
    },
    required: ['phoneNumber', 'callerName', 'language', 'opening', 'goal'],
    additionalProperties: false,
  },
  contract: {
    runtimeRequirements: [BLAND_REQUIREMENT],
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['unknown'],
    sideEffects: ['external_run'],
    riskLevel: 'high',
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
    precedes: [STATUS_TOOL],
    consumes: [
      { kind: 'phone_number', required: false },
      { kind: 'contact_candidate', field: 'phoneNumbers', required: false },
    ],
  },
  handler: async (args, context) => {
    let plan;
    try {
      plan = planAgentCall(args ?? {});
    } catch (error) {
      if (!(error instanceof AgentCallArgumentError)) throw error;
      return failedToolOutcome(
        json({ status: 'invalid_request', error: error.message }),
        'invalid_arguments',
      );
    }
    try {
      const callId = await queueBlandCall(plan.body, context.executionSignal);
      return completedToolOutcome(
        json({
          status: 'call_started',
          callId,
          number: plan.displayNumber,
          maxMinutes: plan.minutes,
          language: plan.blandLanguage,
          next: `Follow the call with ${STATUS_TOOL} {callId}; it waits for the call to end.`,
        }),
      );
    } catch (error) {
      // A request that never got an answer may still have queued the call: calling again
      // could ring the same person twice.
      if (error instanceof BlandError && (error.kind === 'network' || error.kind === 'timeout')) {
        return failedToolOutcome(
          json({
            status: 'unknown',
            error: error.message,
            next: 'It is not known whether the call was placed. Do not call again; tell the person, who can check the call log at app.bland.ai.',
          }),
          'reconciliation_required',
        );
      }
      return failure(error);
    }
  },
};

const AGENT_CALL_STATUS_TOOL: SkillToolDefinition = {
  name: 'agent_call_status',
  description:
    'Follow a call Kavi is handling (started with skill__communication__agent_call): waits up ' +
    `to waitSeconds (default 60, at most ${MAX_WAIT_SECONDS}) for it to end, then returns how ` +
    'it went: status (in_progress, ended, failed), outcome, who answered (human, voicemail), ' +
    'the transcript, a summary, the length and the price. Call again while it is in progress.',
  input_schema: {
    type: 'object',
    properties: {
      callId: { type: 'string', description: 'The callId agent_call returned' },
      waitSeconds: {
        type: 'integer',
        minimum: 0,
        maximum: MAX_WAIT_SECONDS,
        description: `Seconds to wait for the call to end, 0 to ${MAX_WAIT_SECONDS} (default 60)`,
      },
    },
    required: ['callId'],
    additionalProperties: false,
  },
  contract: {
    runtimeRequirements: [BLAND_REQUIREMENT],
    category: 'communication',
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification', 'external_run'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
  },
  handler: async (args, context) => {
    const callId = callIdFrom(args ?? {});
    if (!callId) {
      return failedToolOutcome(
        json({ status: 'invalid_request', error: 'callId must be the id agent_call returned.' }),
        'invalid_arguments',
      );
    }
    try {
      const report = await followAgentCall(
        callId,
        waitSecondsFrom(args?.waitSeconds),
        context.executionSignal,
      );
      return completedToolOutcome(json(report));
    } catch (error) {
      return failure(error);
    }
  },
};

const AGENT_CALL_STOP_TOOL: SkillToolDefinition = {
  name: 'agent_call_stop',
  description:
    'End a call Kavi is handling right away, when the person asks to stop it or to take over.',
  input_schema: {
    type: 'object',
    properties: { callId: { type: 'string', description: 'The callId agent_call returned' } },
    required: ['callId'],
    additionalProperties: false,
  },
  contract: {
    runtimeRequirements: [BLAND_REQUIREMENT],
    category: 'communication',
    capabilities: ['write'],
    resourceKinds: ['unknown'],
    sideEffects: ['remote_mutation'],
    providesEvidence: ['external_run'],
    workflowStages: ['mutate_remote_state'],
  },
  handler: async (args, context) => {
    const callId = callIdFrom(args ?? {});
    if (!callId) {
      return failedToolOutcome(
        json({ status: 'invalid_request', error: 'callId must be the id agent_call returned.' }),
        'invalid_arguments',
      );
    }
    try {
      const message = await stopBlandCall(callId, context.executionSignal);
      return completedToolOutcome(json({ status: 'stopped', callId, message }));
    } catch (error) {
      return failure(error);
    }
  },
};

export function createCommunicationSkill(): Skill {
  return {
    id: 'communication',
    name: 'Communication',
    description: 'Calls Kavi makes and talks on for the person, through Bland.',
    version: '3.0.0',
    tools: [AGENT_CALL_TOOL, AGENT_CALL_STATUS_TOOL, AGENT_CALL_STOP_TOOL],
  };
}
