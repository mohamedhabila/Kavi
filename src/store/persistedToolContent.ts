import { buildHeadTailExcerpt } from '../utils/headTailExcerpt';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type CompactionProfile = {
  maxObjectEntriesRoot: number;
  maxObjectEntriesNested: number;
  maxArrayItemsRoot: number;
  maxArrayItemsNested: number;
  maxStringCharsRoot: number;
  maxStringCharsNested: number;
};

const COMPACTION_PROFILES: CompactionProfile[] = [
  {
    maxObjectEntriesRoot: 18,
    maxObjectEntriesNested: 10,
    maxArrayItemsRoot: 8,
    maxArrayItemsNested: 4,
    maxStringCharsRoot: 480,
    maxStringCharsNested: 240,
  },
  {
    maxObjectEntriesRoot: 12,
    maxObjectEntriesNested: 7,
    maxArrayItemsRoot: 5,
    maxArrayItemsNested: 3,
    maxStringCharsRoot: 320,
    maxStringCharsNested: 160,
  },
  {
    maxObjectEntriesRoot: 8,
    maxObjectEntriesNested: 5,
    maxArrayItemsRoot: 4,
    maxArrayItemsNested: 2,
    maxStringCharsRoot: 220,
    maxStringCharsNested: 120,
  },
];

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const excerpt = buildHeadTailExcerpt(value, maxChars);
  return excerpt.length <= maxChars ? excerpt : value.slice(0, maxChars);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactJsonValue(
  value: unknown,
  profile: CompactionProfile,
  depth = 0,
): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return truncateText(
      value,
      depth === 0 ? profile.maxStringCharsRoot : profile.maxStringCharsNested,
    );
  }

  if (Array.isArray(value)) {
    const maxItems = depth === 0 ? profile.maxArrayItemsRoot : profile.maxArrayItemsNested;
    const items = value.slice(0, maxItems).map((entry) => compactJsonValue(entry, profile, depth + 1));
    if (value.length <= maxItems) {
      return items;
    }

    return {
      items,
      omittedItems: value.length - maxItems,
      totalItems: value.length,
    };
  }

  if (isRecord(value)) {
    const maxEntries =
      depth === 0 ? profile.maxObjectEntriesRoot : profile.maxObjectEntriesNested;
    const entries = Object.entries(value);
    const compactedEntries = entries
      .slice(0, maxEntries)
      .map(([key, entryValue]) => [key, compactJsonValue(entryValue, profile, depth + 1)] as const);
    const compacted: { [key: string]: JsonValue } = Object.fromEntries(compactedEntries);
    if (entries.length > maxEntries) {
      compacted.omittedKeys = entries.length - maxEntries;
    }
    return compacted;
  }

  return truncateText(String(value), profile.maxStringCharsNested);
}

function buildFallbackEnvelope(content: string, maxChars: number): string {
  const base = {
    summary: 'Tool result persisted in compact form.',
    truncated: true,
    originalChars: content.length,
    contentExcerpt: '',
  };

  let excerptBudget = Math.max(160, maxChars - JSON.stringify(base).length - 32);
  while (excerptBudget >= 80) {
    const candidate = JSON.stringify({
      ...base,
      contentExcerpt: buildHeadTailExcerpt(content, excerptBudget),
    });
    if (candidate.length <= maxChars) {
      return candidate;
    }
    excerptBudget = Math.floor(excerptBudget * 0.8);
  }

  return JSON.stringify({
    summary: 'Tool result persisted in compact form.',
    truncated: true,
    originalChars: content.length,
  });
}

export function compactPersistedToolContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return truncateText(trimmed, maxChars);
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    for (const profile of COMPACTION_PROFILES) {
      const compacted = compactJsonValue(parsed, profile);
      const serialized = JSON.stringify(compacted);
      if (serialized.length <= maxChars) {
        return serialized;
      }
    }
  } catch {
    return truncateText(trimmed, maxChars);
  }

  return buildFallbackEnvelope(trimmed, maxChars);
}
