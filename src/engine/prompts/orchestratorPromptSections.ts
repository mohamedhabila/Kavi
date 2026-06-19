import type { Message } from '../../types/message';

export type SystemPromptSection = {
  text: string;
  cacheable?: boolean;
};

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

export function buildRuntimePromptSection(): string {
  return [
    'Runtime: mobile (React Native / Expo), channel mobile-app.',
    'Use the runtime_context block for request time and timezone.',
    'When provider tools are supplied for the turn, batch independent calls and sequence only when later calls depend on earlier results.',
    'Prefer the highest-leverage tool that directly fits the next work unit. If a worker can finish from its prompt, launch it directly and omit worker tools unless narrowing scope.',
    'When freshness, deadlines, schedules, or live state matter, verify with tools or live data.',
    'When a request needs app state or a side effect and the concrete app tool is not on the current surface, use discovery tools to expose the relevant capability before answering.',
    'If the user asks for a durable file, artifact, external update, or other tool-persisted outcome, create or update it before final delivery once the required content is available.',
    'Verification, search, listing, reading, or memory recall is not completion when the same turn also asks you to write, create, send, update, open, or otherwise act; continue to the action tool when possible.',
    'Final answers report completed work or a real blocker, not an unfinished plan.',
    'For web research, use web_search for discovery and web_fetch for reading. Fetch known URLs directly, batch independent fetches, compare sources separately, and re-search only when fetched pages are insufficient.',
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

export function buildRuntimeContextNote(now: Date = new Date()): string {
  const currentTimeIso = now.toISOString();

  return [
    'Runtime context:',
    `request_timestamp_utc: ${currentTimeIso}`,
    `device_local_timezone_offset: ${formatUtcOffset(now.getTimezoneOffset())}`,
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
  options: { cacheable?: boolean } = {},
): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return;
  }

  sections.push({
    text,
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
  conversationMemory: string | null,
  globalMemory: string | null,
  skillsPrompt?: string,
  workflowRuntimePrompt?: string,
  toolingEnabled = true,
  textOnlyTurn = false,
): SystemPromptSection[] {
  const prompt =
    systemPrompt ||
    "You are a personal AI assistant operating in the user's current mobile workspace.";
  const normalizedSkillsPrompt = typeof skillsPrompt === 'string' ? skillsPrompt : '';
  const sections: SystemPromptSection[] = [];

  const safetySection = buildSafetyPromptSection();

  const skillsSection = normalizedSkillsPrompt.trim();

  const conversationMemorySection = conversationMemory
    ? `Conversation memory:\n${conversationMemory}`
    : '';

  const globalMemorySection = globalMemory ? `Global memory:\n${globalMemory}` : '';
  const runtimeContextSection = formatRuntimeContextSection(runtimeContext);

  appendSystemPromptSection(sections, prompt, { cacheable: true });
  appendSystemPromptSection(sections, buildRuntimePromptSection(), { cacheable: true });
  appendSystemPromptSection(sections, safetySection, { cacheable: true });
  appendSystemPromptSection(sections, runtimeContextSection);
  appendSystemPromptSection(
    sections,
    buildExecutionModePromptSection({ toolingEnabled, textOnlyTurn }),
  );
  appendSystemPromptSection(sections, workflowRuntimePrompt);
  appendSystemPromptSection(sections, toolingEnabled ? skillsSection : '', { cacheable: true });
  appendSystemPromptSection(sections, conversationMemorySection);
  appendSystemPromptSection(sections, globalMemorySection);
  return orderSystemPromptSectionsForCaching(sections);
}
