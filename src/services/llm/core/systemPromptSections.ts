import type { ChatCompletionMessage, SystemPromptSection } from '../support/contracts';

export function normalizeSystemPromptSections(
  sections: SystemPromptSection[] | undefined,
): SystemPromptSection[] | undefined {
  if (!Array.isArray(sections) || sections.length === 0) {
    return undefined;
  }

  const normalized = sections
    .map((section) => {
      if (!section || typeof section.text !== 'string' || section.text.trim().length === 0) {
        return null;
      }

      return {
        text: section.text,
        ...(section.cacheable ? { cacheable: true } : {}),
      };
    })
    .filter((section): section is SystemPromptSection => section !== null);

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Returns section metadata only when it is an exact alternate representation
 * of the system prompt already approved in the request messages. Provider
 * cache serializers are allowed to move the stable prefix and dynamic tail to
 * different provider fields, so stale or partial section lists must never be
 * able to replace the approved prompt.
 */
export function selectByteEquivalentSystemPromptSections(
  messages: ReadonlyArray<Pick<ChatCompletionMessage, 'role' | 'content'>>,
  sections: SystemPromptSection[] | undefined,
): SystemPromptSection[] | undefined {
  const normalizedSections = normalizeSystemPromptSections(sections);
  if (!normalizedSections?.length) {
    return undefined;
  }

  const systemMessages = messages.filter((message) => message.role === 'system');
  if (systemMessages.length !== 1 || typeof systemMessages[0]?.content !== 'string') {
    return undefined;
  }

  const sectionPrompt = normalizedSections.map((section) => section.text).join('\n\n');
  return sectionPrompt === systemMessages[0].content ? normalizedSections : undefined;
}

export function splitCacheableSystemPromptSections(sections: SystemPromptSection[] | undefined): {
  cacheableText?: string;
  dynamicText?: string;
} {
  const normalizedSections = normalizeSystemPromptSections(sections);
  if (!normalizedSections?.length) {
    return {};
  }

  const cacheableSections: string[] = [];
  const dynamicSections: string[] = [];
  let prefixClosed = false;

  for (const section of normalizedSections) {
    if (section.cacheable && !prefixClosed) {
      cacheableSections.push(section.text);
      continue;
    }

    prefixClosed = true;
    dynamicSections.push(section.text);
  }

  return {
    ...(cacheableSections.length > 0 ? { cacheableText: cacheableSections.join('\n\n') } : {}),
    ...(dynamicSections.length > 0 ? { dynamicText: dynamicSections.join('\n\n') } : {}),
  };
}
