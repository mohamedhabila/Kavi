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

export function buildRuntimePromptSection(options: {
  toolExecutionAvailable: boolean;
}): string {
  const universalGuidance = [
    'Runtime: mobile (React Native / Expo), channel mobile-app.',
    'Use the runtime_context block for request time and timezone.',
    'Use external-state tools only when the requested answer or action requires live data; mentioning a meeting, deadline, person, or schedule alone does not request inspection.',
    'Natural chitchat memory is recorded after the turn; acknowledge it without memory-management or unrelated tools.',
    'Final answers report completed work or a real blocker, not an unfinished plan.',
  ];
  if (!options.toolExecutionAvailable) {
    return universalGuidance.join('\n');
  }

  return [
    ...universalGuidance,
    'With tools, batch independent calls and sequence only dependencies.',
    'Use the highest-leverage tool. Launch a self-contained worker directly; omit worker tools unless needed to narrow scope.',
    'If requested app state or a side effect needs a tool absent from the surface, use discovery to expose it.',
    'When a durable artifact or external update is requested, create or update it before final delivery once content is available.',
    'Reading, search, recall, or verification is not completion when the request also requires action; continue to the action tool.',
    'For web research, web_search discovers and web_fetch reads. Fetch known URLs directly, batch independent fetches, compare sources, and re-search only if needed.',
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

  const runtimeContextSection = formatRuntimeContextSection(runtimeContext);
  const toolExecutionAvailable = toolingEnabled && !textOnlyTurn;

  appendSystemPromptSection(sections, prompt, { cacheable: true });
  appendSystemPromptSection(
    sections,
    buildRuntimePromptSection({ toolExecutionAvailable }),
    { cacheable: true },
  );
  appendSystemPromptSection(sections, safetySection, { cacheable: true });
  appendSystemPromptSection(sections, runtimeContextSection);
  appendSystemPromptSection(
    sections,
    buildExecutionModePromptSection({ toolingEnabled, textOnlyTurn }),
  );
  appendSystemPromptSection(sections, workflowRuntimePrompt);
  appendSystemPromptSection(sections, toolingEnabled ? skillsSection : '', {
    cacheable: true,
  });
  return orderSystemPromptSectionsForCaching(sections);
}
