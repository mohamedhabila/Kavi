// ---------------------------------------------------------------------------
// Kavi — Guided setup: AI providers, service keys, phone access, calls Kavi handles
// ---------------------------------------------------------------------------
// Vendor pages chosen by what Kavi's own web_fetch extracts (probed 2026-10-16). Gemini's
// rate-limit page carries its free tier further down, so more of it is read. Phone access
// is Android's own settings: no vendor page.

import { SERVICE_SETUP_FIELDS } from '../catalog';
import { guidePages, type SetupGuide, type SetupOption, type SetupPage } from '../setupGuideTypes';

const GEMINI_LIMITS: SetupPage = {
  url: 'https://ai.google.dev/gemini-api/docs/rate-limits',
  about: "Gemini's free tier: which models and how many requests",
  maxChars: 10_000,
};
const OPENROUTER_FAQ: SetupPage = {
  url: 'https://openrouter.ai/docs/faq',
  about: "OpenRouter's free models, credits and limits",
};
const OPENAI_BILLING: SetupPage = {
  url: 'https://help.openai.com/en/articles/8264644',
  about: "OpenAI's prepaid credit: the minimum and how it is bought",
};

const AI_PROVIDER_OPTIONS: ReadonlyArray<SetupOption> = [
  {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    why: 'Free to start with a Google account, no card; the quickest way to begin.',
    pages: [
      {
        url: 'https://ai.google.dev/gemini-api/docs/api-key',
        about: 'how to create a Gemini API key in Google AI Studio',
      },
      GEMINI_LIMITS,
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    why: 'One key for models from many companies, including some free ones.',
    pages: [
      OPENROUTER_FAQ,
      {
        url: 'https://openrouter.ai/docs/api/reference/authentication',
        about: 'how to create an OpenRouter API key',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    why: 'Pay as you go; a ChatGPT subscription does not include API use.',
    pages: [
      OPENAI_BILLING,
      { url: 'https://platform.openai.com/docs/quickstart', about: 'how to create an API key' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    why: 'Pay as you go; the models Kavi is measured on.',
    pages: [
      {
        url: 'https://docs.claude.com/en/api/overview',
        about: 'how to get a Claude API key in the Console',
      },
      { url: 'https://docs.claude.com/en/docs/get-started', about: 'getting started with the API' },
    ],
  },
];

export function aiProviderGuide(optionId?: string): SetupGuide {
  const chosen = AI_PROVIDER_OPTIONS.find((option) => option.id === optionId);
  return {
    topic: 'ai_provider',
    title: chosen ? `Connect ${chosen.name}` : 'Connect an AI provider',
    unlocks: 'Kavi answers and acts with the AI models of the provider the key belongs to.',
    options: AI_PROVIDER_OPTIONS,
    ...(chosen ? { optionId: chosen.id } : {}),
    pages: guidePages(AI_PROVIDER_OPTIONS, optionId, [
      GEMINI_LIMITS,
      OPENROUTER_FAQ,
      OPENAI_BILLING,
    ]),
    kaviSteps: [
      'In Kavi, open the AI provider form (Kavi can open it), pick the provider and paste the key. Never paste a key into the chat.',
    ],
    form: {
      kind: 'settings',
      section: 'provider-edit',
      ...(chosen ? { draft: { provider: chosen.id } } : {}),
    },
    afterSetup: 'Kavi can use the new provider right away; carry on with what the person asked.',
  };
}

/** A service that needs an API key (web search, GitHub, weather, finance, …). */
export function serviceKeyGuide(optionId?: string): SetupGuide {
  const options: SetupOption[] = SERVICE_SETUP_FIELDS.map((field) => ({
    id: field.storageKey,
    name: field.label,
    why: field.unlocks,
    ...(field.docsUrl
      ? {
          pages: [{ url: field.docsUrl, about: `how to get the ${field.label} and what it costs` }],
        }
      : {}),
  }));
  const chosen = SERVICE_SETUP_FIELDS.find((field) => field.storageKey === optionId);
  return {
    topic: 'service_key',
    title: chosen ? `Add the ${chosen.label}` : 'Add a service key',
    unlocks: chosen
      ? chosen.unlocks
      : 'Kavi gains web search, GitHub, weather, finance and other services, each with its own key.',
    options,
    ...(chosen ? { optionId: chosen.storageKey } : {}),
    pages: guidePages(options, optionId, []),
    kaviSteps: [
      chosen
        ? `In Kavi, open the service keys (Kavi can open them) and paste it as the ${chosen.label}. Never paste it into the chat.`
        : 'Pick the service from the options; its page says how to get the key.',
    ],
    form: { kind: 'settings', section: 'service-keys' },
    afterSetup: 'Use the service for what the person asked.',
  };
}

export function phoneAccessGuide(optionId?: string): SetupGuide {
  const notificationAccess = optionId === 'notification_access';
  return {
    topic: 'phone_access',
    title: notificationAccess
      ? 'Let Kavi read and answer notifications'
      : 'Make Kavi the phone assistant',
    unlocks: notificationAccess
      ? 'Kavi can read the notifications other apps show, and reply to messages (WhatsApp, Telegram, Messages, …) from them. Android only.'
      : 'Kavi opens with a long press on the home button, and sends texts itself once approved. Android only.',
    options: [
      {
        id: 'assistant_role',
        name: 'Default digital assistant',
        why: 'Replaces the current assistant (often Google).',
      },
      {
        id: 'notification_access',
        name: 'Notification access',
        why: 'Kavi only reads notifications when asked, and keeps them on the phone.',
      },
    ],
    optionId: notificationAccess ? 'notification_access' : 'assistant_role',
    pages: [],
    kaviSteps: notificationAccess
      ? [
          'Open the notification access page (Kavi can open it).',
          'Turn on access for Kavi and confirm.',
        ]
      : [
          'Open the assistant settings (Kavi can open them).',
          'Choose Digital assistant app (it may be under Default apps) and pick Kavi.',
        ],
    form: { kind: 'system', access: notificationAccess ? 'notification_access' : 'assistant_role' },
    afterSetup: 'Carry on with what the person asked.',
  };
}

const BLAND_PAGES: ReadonlyArray<SetupPage> = [
  { url: 'https://www.bland.ai/pricing', about: "Bland's plans and per-minute prices" },
  { url: 'https://docs.bland.ai/platform/billing', about: 'how Bland credit and billing work' },
];

export const PHONE_CALLS_GUIDE: SetupGuide = {
  topic: 'phone_calls',
  title: 'Let Kavi make calls for you',
  unlocks:
    "Kavi calls a business (or a person who agreed to it) and talks for the person: booking a table, asking about opening hours or prices, rescheduling. Kavi's voice says it is an AI assistant calling on their behalf, and Kavi reports back what was said and agreed. Phones do not let apps speak into a normal call, so these calls go out through Bland, a calling service, from one of its numbers.",
  options: [
    {
      id: 'bland',
      name: 'Bland',
      why: 'One key and no phone number to buy; calls show a Bland number, not the person’s.',
      pages: BLAND_PAGES,
    },
  ],
  optionId: 'bland',
  pages: BLAND_PAGES,
  kaviSteps: [
    'At app.bland.ai, create an account and add credit; the API key is in the account settings (search the web if the person cannot find it).',
    'In Kavi, open the service keys (Kavi can open them) and paste it as the Bland API key. Never paste it into the chat.',
  ],
  form: { kind: 'settings', section: 'service-keys' },
  afterSetup: 'Carry on with the call the person asked for.',
  safety: [
    'Every call starts by saying it is an AI assistant calling for the person and that it is recorded.',
    'Before calling, show the person the number and exactly what Kavi will say and share, and call only after they approve.',
    'Call businesses freely; call a private person only when the person says that contact agreed to a call from an AI (in the US the law requires it for mobile numbers).',
    'Never call emergency numbers, sell anything, or give payment details, ID numbers or health information on a call.',
  ],
};
