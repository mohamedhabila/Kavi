import type { Message } from '../../types/message';

export type SystemPromptSectionPurpose =
  | 'base_prompt'
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

export function buildRuntimePromptSection(options: { toolExecutionAvailable: boolean }): string {
  const universalGuidance = [
    'Runtime: mobile (React Native / Expo), channel mobile-app.',
    'Use the runtime_context block for request time and timezone.',
    'Use external-state tools only when the requested answer or action requires live data; mentioning a meeting, deadline, person, or schedule alone does not request inspection.',
    DURABLE_MEMORY_ACKNOWLEDGEMENT_CONTRACT,
    MEMORY_MINIMAL_DISCLOSURE_CONTRACT,
    'Answer the requested scope directly. Add only context or caveats needed for correctness, safety, or the next required user decision.',
    'Final answers report completed work or a real blocker, not an unfinished plan.',
  ];
  if (!options.toolExecutionAvailable) {
    return universalGuidance.join('\n');
  }

  return [
    ...universalGuidance,
    'With tools, batch independent calls and sequence only dependencies.',
    'When user-owned information is genuinely required before safe or complete execution and cannot be obtained from visible context, memory, or a read-only tool, call request_clarification with stable semantic field keys and one question. Do not combine it with another tool call.',
    'Use the highest-leverage tool. Launch a self-contained worker directly; omit worker tools unless needed to narrow scope.',
    'If requested app state or a side effect needs a tool absent from the surface, use discovery to expose it.',
    'When a durable artifact or external update is requested, create or update it before final delivery once content is available.',
    'Reading, search, recall, or verification is not completion when the request also requires action; continue to the action tool.',
    'When the user provides exact file paths, read those paths directly; do not list parent directories merely to confirm that the named files exist.',
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
  const prompt =
    systemPrompt ||
    "You are a personal AI assistant operating in the user's current mobile workspace.";
  const normalizedSkillsPrompt = typeof skillsPrompt === 'string' ? skillsPrompt : '';
  const sections: SystemPromptSection[] = [];

  const safetySection = buildSafetyPromptSection();

  const skillsSection = normalizedSkillsPrompt.trim();

  const runtimeContextSection = formatRuntimeContextSection(runtimeContext);
  const toolExecutionAvailable = toolingEnabled && !textOnlyTurn;

  appendSystemPromptSection(sections, prompt, { cacheable: true, purpose: 'base_prompt' });
  appendSystemPromptSection(sections, buildRuntimePromptSection({ toolExecutionAvailable }), {
    cacheable: true,
    purpose: 'runtime_guidance',
  });
  appendSystemPromptSection(sections, safetySection, { cacheable: true, purpose: 'safety' });
  appendSystemPromptSection(sections, runtimeContextSection, { purpose: 'runtime_context' });
  appendSystemPromptSection(
    sections,
    buildExecutionModePromptSection({ toolingEnabled, textOnlyTurn }),
    { purpose: 'execution_mode' },
  );
  appendSystemPromptSection(sections, workflowRuntimePrompt, { purpose: 'workflow_runtime' });
  appendSystemPromptSection(sections, toolingEnabled ? skillsSection : '', {
    cacheable: true,
    purpose: 'skills',
  });
  return orderSystemPromptSectionsForCaching(sections);
}
