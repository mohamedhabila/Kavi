import type { ToolDefinition } from '../../types/tool';
import { SETUP_TOPICS } from '../../services/setup/setupGuideTypes';

export const SETUP_GUIDE_TOOL_NAME = 'setup_guide';

/**
 * On every turn's surface: the tools these topics unlock are hidden until their service is
 * set up, so this description is how the model learns Kavi can do them at all.
 */
export const SETUP_GUIDE_TOOL: ToolDefinition = {
  name: SETUP_GUIDE_TOOL_NAME,
  description:
    'Guide the person through setting up something Kavi needs for what they asked, when it is ' +
    'not set up yet: app_building (build and publish mobile and web apps with Expo), server ' +
    '(a free or cheap VPS Kavi works on over SSH), connect_app (Notion, Linear, Jira, GitHub, ' +
    'Stripe, Canva, Zapier and other services; option = the service), ai_provider (an AI ' +
    'model key; option = gemini, openrouter, openai or anthropic), service_key (web search, ' +
    'GitHub, weather and other service keys), phone_access (Android: option assistant_role to ' +
    'send texts itself, notification_access to read and answer notifications), phone_calls ' +
    '(Kavi talks on calls for the person). Returns whether it is already set up, the options ' +
    'with what they cost, plain steps and what to enter where; the person also sees a card ' +
    'that opens the right Kavi form. Walk them through it in their language, one step at a ' +
    'time, and never ask for a key or password in the chat: they enter it in the form.',
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', enum: [...SETUP_TOPICS], description: 'What to set up' },
      option: {
        type: 'string',
        description: 'Optional: the option or service, such as notion, digitalocean or gemini',
      },
    },
    required: ['topic'],
  },
  contract: {
    category: 'interaction',
    capabilities: ['discover', 'read'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: [],
    workflowStages: ['discover_resource'],
  },
};
