// ---------------------------------------------------------------------------
// Kavi — The draft a setup guide opens a Settings form with
// ---------------------------------------------------------------------------
// A setup card opens a form already filled in with what the guide knows: a service's
// address, an SSH port and username, an account type. Route params are untrusted input,
// so each form takes only its own known, non-secret fields, each checked.

import {
  DEFAULT_GEMINI_AI_STUDIO_BASE_URL,
  KNOWN_PROVIDERS,
  type LlmProviderPreset,
} from '../../constants/api';
import type { ExpoAccountConfig, McpServerConfig, SshTargetConfig } from '../../types/remote';

export type SetupRouteParams = Readonly<{
  section?: string;
  setupDraft?: unknown;
  /** Distinguishes two cards opening the same form. */
  setupRequestId?: number;
}>;

function draftRecord(draft: unknown): Record<string, unknown> {
  return draft && typeof draft === 'object' && !Array.isArray(draft)
    ? (draft as Record<string, unknown>)
    : {};
}

function shortText(value: unknown, max = 120): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max
    ? value.trim()
    : undefined;
}

export function mcpDraftFromRoute(draft: unknown): Partial<McpServerConfig> {
  const record = draftRecord(draft);
  const name = shortText(record.name);
  const url = shortText(record.url, 2048);
  return {
    ...(name ? { name } : {}),
    ...(url && /^https:\/\/[^\s]+$/u.test(url) ? { url } : {}),
  };
}

export function sshDraftFromRoute(draft: unknown): Partial<SshTargetConfig> {
  const record = draftRecord(draft);
  const port = Number(record.port);
  const username = shortText(record.username, 64);
  return {
    ...(Number.isInteger(port) && port > 0 && port < 65_536 ? { port } : {}),
    ...(username && /^[a-z_][a-z0-9_.-]*$/iu.test(username) ? { username } : {}),
    ...(record.authMode === 'password' || record.authMode === 'private-key'
      ? { authMode: record.authMode }
      : {}),
    ...(record.hostKeyPolicy === 'strict' || record.hostKeyPolicy === 'trust-on-first-use'
      ? { hostKeyPolicy: record.hostKeyPolicy }
      : {}),
  };
}

export function expoDraftFromRoute(draft: unknown): Partial<ExpoAccountConfig> {
  const record = draftRecord(draft);
  return record.accountType === 'personal' || record.accountType === 'robot'
    ? { accountType: record.accountType }
    : {};
}

const PROVIDER_PRESET_NAMES: Readonly<Record<string, string>> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
};

/**
 * The model the Gemini guide's free key can use: the free tier covers the Flash and
 * Flash-Lite models, not the preset's default (ai.google.dev/gemini-api/docs/pricing,
 * checked 2026-10-15).
 */
const GEMINI_FREE_TIER_MODEL = 'gemini-3.8-flash';

/**
 * The provider preset a setup guide's draft asks for, if it names one Kavi knows. The
 * Gemini guide hands out a Google AI Studio key, which the Gemini API takes and Vertex AI
 * (the preset's default address) does not.
 */
export function providerPresetFromRoute(draft: unknown): LlmProviderPreset | undefined {
  const provider = draftRecord(draft).provider;
  const presetName = typeof provider === 'string' ? PROVIDER_PRESET_NAMES[provider] : undefined;
  const preset = KNOWN_PROVIDERS.find((candidate) => candidate.name === presetName);
  if (!preset || provider !== 'gemini' || preset.kind !== 'remote') return preset;
  return {
    ...preset,
    baseUrl: DEFAULT_GEMINI_AI_STUDIO_BASE_URL,
    defaultModel: GEMINI_FREE_TIER_MODEL,
  };
}

/** The key a route-driven form opening is remembered by, so each request opens once. */
export function setupRouteKey(params: SetupRouteParams | undefined): string | null {
  if (!params?.section) return null;
  return `${params.section}:${params.setupRequestId ?? ''}`;
}
