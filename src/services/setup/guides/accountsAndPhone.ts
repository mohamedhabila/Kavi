// ---------------------------------------------------------------------------
// Kavi — Guided setup: AI providers, service keys, phone access
// ---------------------------------------------------------------------------
// Facts checked against the vendors' own pages on 2026-10-15. Menu labels
// that could not be confirmed are described by the page and what to look for.

import { SERVICE_SETUP_FIELDS } from '../catalog';
import type { SetupGuide, SetupOption } from '../setupGuideTypes';

const AI_PROVIDER_OPTIONS: ReadonlyArray<SetupOption & { steps: ReadonlyArray<string> }> = [
  {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    cost: 'Free tier with Flash and Flash-Lite models and per-model daily limits; no card needed.',
    notes:
      'Prompts sent on the free tier may be used to improve Google products. The quickest way to start.',
    url: 'https://aistudio.google.com',
    steps: [
      'Open aistudio.google.com and sign in with a Google account.',
      'Find the API keys page ("Get API key"), create a key and copy it.',
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    cost: 'Free models: 50 requests a day, or 1,000 a day after buying 10 credits; paid models charge per use.',
    notes: 'One key for models from many companies.',
    url: 'https://openrouter.ai',
    steps: [
      'Open openrouter.ai and sign in with Google, GitHub or an email.',
      'Open Keys, create a key (a spending limit is optional) and copy it.',
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    cost: 'Pay as you go: buy at least $5 of credit (it expires after a year).',
    notes: 'A ChatGPT login works, but a ChatGPT subscription does not include API credit.',
    url: 'https://platform.openai.com',
    steps: [
      'Open platform.openai.com and sign in.',
      'In Settings, Billing, add a card and buy credit ($5 minimum); turning off auto-recharge is safer.',
      'Open API keys, create a secret key named "Kavi" and copy it.',
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    cost: 'Pay as you go: buy at least $5 of credit.',
    notes: 'The models Kavi is measured on.',
    url: 'https://platform.claude.com',
    steps: [
      'Open platform.claude.com and sign up.',
      'Open Billing and buy credit ($5 minimum).',
      'Open API keys, create a key and copy it.',
    ],
  },
];

export function aiProviderGuide(optionId?: string): SetupGuide {
  const chosen = AI_PROVIDER_OPTIONS.find((option) => option.id === optionId);
  return {
    topic: 'ai_provider',
    title: chosen ? `Connect ${chosen.name}` : 'Connect an AI provider',
    unlocks: 'Kavi answers and acts with the AI models of the provider the key belongs to.',
    options: AI_PROVIDER_OPTIONS.map(({ steps: _steps, ...option }) => option),
    ...(chosen ? { optionId: chosen.id } : {}),
    steps: [
      ...(chosen
        ? chosen.steps
        : ['Pick a provider from the options; Google AI Studio is free to start.']),
      'In Kavi, open the AI provider form (Kavi can open it), pick the provider and paste the key. Never paste a key into the chat.',
    ],
    form: {
      kind: 'settings',
      section: 'provider-edit',
      ...(chosen ? { draft: { provider: chosen.id } } : {}),
    },
    afterSetup: 'Kavi can use the new provider right away; carry on with what the person asked.',
    sources: [
      'https://ai.google.dev/gemini-api/docs/pricing',
      'https://openrouter.ai/docs/api/reference/limits',
      'https://help.openai.com/en/articles/8264644',
    ],
    verifiedOn: '2026-10-15',
  };
}

/** A service that needs an API key (web search, GitHub, weather, finance, …). */
export function serviceKeyGuide(optionId?: string): SetupGuide {
  const options = SERVICE_SETUP_FIELDS.map((field) => ({
    id: field.storageKey,
    name: field.label,
    cost: field.freeAccess,
    notes: field.unlocks,
    ...(field.docsUrl ? { url: field.docsUrl } : {}),
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
    steps: chosen
      ? [
          chosen.setup,
          `In Kavi, open the service keys (Kavi can open them) and paste it as ${chosen.label}.`,
        ]
      : ['Pick the service from the options.'],
    form: { kind: 'settings', section: 'service-keys' },
    afterSetup: 'Use the service for what the person asked.',
    sources: options.flatMap((option) => (option.url ? [option.url] : [])),
    verifiedOn: '2026-10-15',
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
        cost: 'Free',
        notes: 'Replaces the current assistant (often Google).',
      },
      {
        id: 'notification_access',
        name: 'Notification access',
        cost: 'Free',
        notes: 'Kavi only reads notifications when asked, and keeps them on the phone.',
      },
    ],
    optionId: notificationAccess ? 'notification_access' : 'assistant_role',
    steps: notificationAccess
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
    sources: [
      'https://support.google.com/googleplay/android-developer/answer/10208820',
      'https://developer.android.com/reference/android/service/notification/NotificationListenerService',
    ],
    verifiedOn: '2026-10-15',
  };
}
