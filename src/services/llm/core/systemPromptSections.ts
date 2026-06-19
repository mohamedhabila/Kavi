import type { SystemPromptSection } from '../support/contracts';

export function normalizeSystemPromptSections(
  sections: SystemPromptSection[] | undefined,
): SystemPromptSection[] | undefined {
  if (!Array.isArray(sections) || sections.length === 0) {
    return undefined;
  }

  const normalized = sections
    .map((section) => {
      if (
        !section ||
        typeof section.text !== 'string' ||
        section.text.trim().length === 0
      ) {
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

export function splitCacheableSystemPromptSections(
  sections: SystemPromptSection[] | undefined,
): { cacheableText?: string; dynamicText?: string } {
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
    ...(cacheableSections.length > 0
      ? { cacheableText: cacheableSections.join('\n\n') }
      : {}),
    ...(dynamicSections.length > 0
      ? { dynamicText: dynamicSections.join('\n\n') }
      : {}),
  };
}
