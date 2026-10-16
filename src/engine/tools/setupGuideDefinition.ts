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
    '(Kavi talks on calls for the person). Returns whether it is already set up, the options, ' +
    "the steps inside Kavi and what to enter where, and research: the vendors' own pages as " +
    'they read right now (call again with option once the person picks one, for its steps). ' +
    "Take prices, limits and the steps on the vendor's site from research and name the page; " +
    'quote prices as the page states them and work out any estimate from them exactly (3 ' +
    'minutes at $0.14 a minute is $0.42). ' +
    'A price research does not show (a page that failed, a domain name, another vendor) comes ' +
    'from web_fetch or web_search, or is left out: never from memory. The person also sees ' +
    'a card that opens the right Kavi form. Walk them through it in their language, one ' +
    'step at a time, and never ask for a key or password in the chat: they enter it in ' +
    'the form.',
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
    capabilities: ['discover', 'read', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    boundedOutput: true,
    riskHints: ['read_only', 'idempotent', 'open_world'],
    providesEvidence: [],
    workflowStages: ['discover_resource'],
  },
};
