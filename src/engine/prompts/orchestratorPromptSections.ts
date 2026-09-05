import type { Message } from '../../types/message';
import { isToolRuntimeAvailable } from '../tools/runtimeAvailability';
import { i18n } from '../../i18n/manager';
import { getLocaleBcp47Tag } from '../../i18n/localeBcp47';
import type { Locale } from '../../i18n/types';

export type SystemPromptSectionPurpose =
  | 'base_prompt'
  | 'capability_index'
  | 'execution_mode'
  | 'forced_text'
  | 'goals'
  | 'living_memory'
  | 'memory_policy'
  | 'runtime_context'
  | 'runtime_guidance'
  | 'safety'
  | 'skills'
  | 'verified_procedure'
  | 'workflow_runtime'
  | 'workflow_task_anchor';

export type SystemPromptSection = {
  text: string;
  cacheable?: boolean;
  /** Code-owned purpose used for budgeting and policy; never inferred from rendered text. */
  purpose: SystemPromptSectionPurpose;
};

export const DURABLE_MEMORY_ACKNOWLEDGEMENT_CONTRACT =
  'Passive memory runs only after final delivery. Acknowledge the information itself. Without verified current-turn durable-memory write evidence, never say it was remembered, saved, stored, or updated, and never promise to remember or save it.';

export const MEMORY_MINIMAL_DISCLOSURE_CONTRACT =
  'Treat recalled memory as context, not a disclosure checklist. Include only remembered details needed for the current request; do not volunteer superseded values or unrelated remembered context.';

const WEB_SEARCH_TOOL_NAME = 'web_search';

/**
 * Shown only when web_search is off the turn surface (no provider configured). Without
 * it, a model with no search tool and an unfamiliar domain (e.g. current weather) had no
 * code-owned path to a keyless source and told the user the capability needed setup,
 * even though web_fetch — already on the surface — could reach one directly. Verified
 * against each provider's own docs on 2026-09-05.
 */
const KEYLESS_PUBLIC_SOURCES_GUIDANCE =
  'Keyless web_fetch sources: weather — Open-Meteo geocoding ' +
  '(https://geocoding-api.open-meteo.com/v1/search?name=…) then forecast ' +
  '(https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=…&timezone=auto); ' +
  'facts — Wikipedia (https://<lang>.wikipedia.org/api/rest_v1/page/summary/<title>); many sites are ' +
  'readable directly. Try one before mentioning setup; only mention it after a fetch fails.';

export function formatUtcOffset(offsetMinutesWestOfUtc: number): string {
  const totalMinutes = -offsetMinutesWestOfUtc;
  const sign = totalMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absoluteMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (absoluteMinutes % 60).toString().padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

export function buildRuntimePromptSection(options: {
  toolExecutionAvailable: boolean;
  /**
   * Whether a search tool is actually on this run's surface.
   *
   * Guidance naming a tool is an advertisement for it. `web_search` is gated on a
   * configured provider and is correctly dropped from the surface when there is none —
   * but this line named it unconditionally, so the model was told to search, called a
   * tool it had never been given, and the call failed. Traced on-device: every research
   * request opened with a failed `web_search` followed by a `tool_catalog` round-trip
   * before falling back to `web_fetch`, which had been the only usable path all along.
   *
   * Naming the fallback instead of the missing tool costs the same tokens and starts the
   * run on the path that works.
   */
  webSearchAvailable?: boolean;
}): string {
  const universalGuidance = [
    'Runtime: mobile (React Native / Expo), channel mobile-app.',
    'Use the runtime_context block for request time, timezone, locale, and measurement system.',
    "Always reply in the language of the user's latest message, matching their register, unless they ask you to switch. This holds for every persona, including a fully custom one.",
    'Never narrate internal tools, goals, runs, personas, or other mechanics to the user; report outcomes and blockers in plain terms. This holds for every persona, including a fully custom one.',
    'Use external-state tools only when the requested answer or action requires live data; mentioning a meeting, deadline, person, or schedule alone does not request inspection.',
    DURABLE_MEMORY_ACKNOWLEDGEMENT_CONTRACT,
    MEMORY_MINIMAL_DISCLOSURE_CONTRACT,
    'A retrieved memory fact labeled policy=use is already resolved input for this turn. Use it directly when it supplies a requested parameter; do not request clarification for that parameter.',
    'Answer the requested scope directly. Add only context or caveats needed for correctness, safety, or the next required user decision.',
    'Final answers report completed work or a real blocker, not an unfinished plan.',
  ];
  if (!options.toolExecutionAvailable) {
    return universalGuidance.join('\n');
  }

  return [
    ...universalGuidance,
    'With tools, batch independent calls and sequence only dependencies.',
    'An internal identifier for a named existing app resource is not user-owned missing information. Resolve it through the available tool surface: use a unique name selector when supported, otherwise use read-only discovery; request clarification only when no unique match remains.',
    'When user-owned information is genuinely required before safe or complete execution and cannot be obtained from visible context, memory, or a read-only tool, call request_clarification with stable semantic field keys and one question. Do not combine it with another tool call.',
    'Use the highest-leverage tool. Launch a self-contained worker directly; omit worker tools unless needed to narrow scope.',
    'If requested app state or a side effect needs a tool absent from the surface, use discovery to expose it.',
    'When a durable artifact or external update is requested, create or update it before final delivery once content is available.',
    'Reading, search, recall, or verification is not completion when the request also requires action; continue to the action tool.',
    'A successful tool call proves only the exact result it returned. Before final delivery, compare result fields and verified effects with every explicit requested outcome and constraint; if any remains unsatisfied, continue with a corrected action or report the concrete blocker.',
    options.webSearchAvailable === false
      ? 'For web research, no search provider is configured, so web_search is unavailable: reach pages directly with web_fetch. Batch independent fetches and compare sources.'
      : 'For web research, web_search discovers and web_fetch reads. Fetch known URLs directly, batch independent fetches, compare sources, and re-search only if needed.',
    ...(options.webSearchAvailable === false ? [KEYLESS_PUBLIC_SOURCES_GUIDANCE] : []),
  ].join('\n');
}

function buildExecutionModePromptSection(options: {
  toolingEnabled: boolean;
  textOnlyTurn: boolean;
}): string {
  if (options.toolingEnabled && !options.textOnlyTurn) {
    return '';
  }

  return [
    'Execution mode for this turn: no registered executable tools are available.',
    'Do not emit tool calls, function-call blocks, or provider-specific raw tool-call markup.',
    'Answer from visible context. If tool-driven work is requested, state that this mode cannot execute tools and give the best direct answer.',
  ].join('\n');
}

/** Locale regions that use US customary units instead of metric. */
const US_CUSTOMARY_BCP47_REGIONS = new Set(['US', 'LR', 'MM']);

function resolveDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function resolveMeasurementSystem(bcp47Tag: string): 'metric' | 'us_customary' {
  const region = bcp47Tag.split('-')[1]?.toUpperCase();
  return region && US_CUSTOMARY_BCP47_REGIONS.has(region) ? 'us_customary' : 'metric';
}

export function buildRuntimeContextNote(
  now: Date = new Date(),
  overrides: { locale?: Locale; timeZone?: string } = {},
): string {
  const currentTimeIso = now.toISOString();
  const locale = overrides.locale ?? i18n.locale;
  const timeZone = overrides.timeZone ?? resolveDeviceTimeZone();
  const bcp47Tag = getLocaleBcp47Tag(locale);

  return [
    'Runtime context:',
    `request_timestamp_utc: ${currentTimeIso}`,
    `device_local_timezone_offset: ${formatUtcOffset(now.getTimezoneOffset())}`,
    `device_timezone: ${timeZone}`,
    `device_locale: ${bcp47Tag}`,
    `measurement_system: ${resolveMeasurementSystem(bcp47Tag)}`,
    'Treat this runtime context as authoritative for time-sensitive reasoning in this request.',
  ].join('\n');
}

function formatRuntimeContextSection(runtimeContext: string | null): string {
  const trimmed = runtimeContext?.trim() || '';
  if (!trimmed) {
    return '';
  }
  return /<runtime_context>[\s\S]*<\/runtime_context>/i.test(trimmed)
    ? trimmed
    : `<runtime_context>\n${trimmed}\n</runtime_context>`;
}

export function stripRuntimeContextFromUserContent(content: string | undefined): string {
  if (typeof content !== 'string') {
    return '';
  }

  return content
    .replace(/\s*<runtime_context>[\s\S]*?<\/runtime_context>\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getUserMessagePromptContent(
  message: Pick<Message, 'content' | 'enrichedContent'>,
): string {
  const sanitizedEnrichedContent = stripRuntimeContextFromUserContent(message.enrichedContent);
  if (sanitizedEnrichedContent.length > 0) {
    return sanitizedEnrichedContent;
  }

  return stripRuntimeContextFromUserContent(message.content);
}

export function appendSystemPromptSection(
  sections: SystemPromptSection[],
  text: string | null | undefined,
  options: { cacheable?: boolean; purpose: SystemPromptSectionPurpose },
): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return;
  }

  sections.push({
    text,
    purpose: options.purpose,
    ...(options.cacheable ? { cacheable: true } : {}),
  });
}

export function orderSystemPromptSectionsForCaching(
  sections: SystemPromptSection[],
): SystemPromptSection[] {
  if (sections.length <= 1) {
    return sections;
  }

  const cacheableSections: SystemPromptSection[] = [];
  const dynamicSections: SystemPromptSection[] = [];

  for (const section of sections) {
    if (section.cacheable) {
      cacheableSections.push(section);
      continue;
    }

    dynamicSections.push(section);
  }

  if (cacheableSections.length === 0 || dynamicSections.length === 0) {
    return sections;
  }

  // Keep the reusable prefix byte-stable across providers by moving all
  // volatile sections behind the cacheable prefix boundary.
  return [...cacheableSections, ...dynamicSections];
}

export function joinSystemPromptSections(sections: SystemPromptSection[]): string {
  return sections.map((section) => section.text).join('\n\n');
}

export function buildSafetyPromptSection(): string {
  return [
    "Safety: no independent goals beyond the user's request.",
    'Honor stop or pause requests. Never bypass safeguards or pressure users to expand access.',
  ].join('\n');
}

export function buildSystemPromptSections(
  systemPrompt: string,
  runtimeContext: string | null,
  skillsPrompt?: string,
  workflowRuntimePrompt?: string,
  toolingEnabled = true,
  textOnlyTurn = false,
): SystemPromptSection[] {
  const prompt = systemPrompt || "You are Kavi, a personal assistant on the user's phone.";
  const normalizedSkillsPrompt = typeof skillsPrompt === 'string' ? skillsPrompt : '';
  const sections: SystemPromptSection[] = [];

  const safetySection = buildSafetyPromptSection();

  const skillsSection = normalizedSkillsPrompt.trim();

  const runtimeContextSection = formatRuntimeContextSection(runtimeContext);
  const toolExecutionAvailable = toolingEnabled && !textOnlyTurn;

  appendSystemPromptSection(sections, prompt, { cacheable: true, purpose: 'base_prompt' });
  appendSystemPromptSection(
    sections,
    buildRuntimePromptSection({
      toolExecutionAvailable,
      webSearchAvailable: isToolRuntimeAvailable(WEB_SEARCH_TOOL_NAME),
    }),
    {
      cacheable: true,
      purpose: 'runtime_guidance',
    },
  );
  appendSystemPromptSection(sections, safetySection, { cacheable: true, purpose: 'safety' });
  appendSystemPromptSection(sections, runtimeContextSection, { purpose: 'runtime_context' });
  appendSystemPromptSection(
    sections,
    buildExecutionModePromptSection({
      toolingEnabled,
      textOnlyTurn,
    }),
    { purpose: 'execution_mode' },
  );
  appendSystemPromptSection(sections, workflowRuntimePrompt, { purpose: 'workflow_runtime' });
  appendSystemPromptSection(sections, toolingEnabled ? skillsSection : '', {
    cacheable: true,
    purpose: 'skills',
  });
  return orderSystemPromptSectionsForCaching(sections);
}
