import type { ToolDefinition } from '../../../../types/tool';
import type { SystemPromptSection } from '../../support/contracts';
import {
  normalizeSystemPromptSections,
  splitCacheableSystemPromptSections,
} from '../../core/systemPromptSections';
import { buildPromptCachingToolOrder } from '../../core/toolCaching';
import { truncateToUtf16BudgetGraphemeSafe } from '../../../../utils/graphemes';

export const ANTHROPIC_INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';
/**
 * Lets a request set thinking.block_binding. Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku
 * 5.5 accept a replayed thinking block only while everything before it is unchanged, and
 * Kavi changes earlier history on purpose (the history window, compaction, each turn's
 * context): with drop_block the API drops such a block instead of refusing the request.
 * https://platform.claude.com/docs/en/build-with-claude/preserved-thinking
 */
export const ANTHROPIC_THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';
export const ANTHROPIC_EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const;
const ANTHROPIC_TOOL_DESCRIPTION_CHAR_LIMIT = 2000;

export function strictifySchema(schema: Record<string, any>): Record<string, any> {
  if (!schema || typeof schema !== 'object') return schema;
  const result = { ...schema };
  if (result.type === 'object') {
    result.additionalProperties = false;
    if (!result.required) result.required = [];
    if (result.properties) {
      const props: Record<string, any> = {};
      for (const [key, val] of Object.entries(result.properties)) {
        props[key] = strictifySchema(val as Record<string, any>);
      }
      result.properties = props;
    }
  }
  if (result.items && typeof result.items === 'object') {
    result.items = strictifySchema(result.items);
  }
  return result;
}

export function simplifyAnthropicToolDescription(description: string | undefined): string {
  const trimmed = (description || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= ANTHROPIC_TOOL_DESCRIPTION_CHAR_LIMIT) return trimmed;
  const suffix = '...';
  const truncated = truncateToUtf16BudgetGraphemeSafe(
    trimmed,
    ANTHROPIC_TOOL_DESCRIPTION_CHAR_LIMIT - suffix.length,
  );
  return `${truncated.trimEnd()}${suffix}`;
}

export function buildAnthropicSystemPromptContent(args: {
  systemContent?: string;
  sections?: SystemPromptSection[];
  enablePromptCaching?: boolean;
}): string | Array<Record<string, any>> | undefined {
  const normalizedSections = normalizeSystemPromptSections(args.sections);
  if (!normalizedSections?.length) {
    return args.systemContent;
  }

  if (!args.enablePromptCaching) {
    return normalizedSections.map((section) => ({ type: 'text', text: section.text }));
  }

  const { cacheableText } = splitCacheableSystemPromptSections(args.sections);
  if (!cacheableText) {
    return undefined;
  }

  let lastCacheablePrefixIndex = -1;
  for (const [sectionIndex, section] of normalizedSections.entries()) {
    if (!section.cacheable) {
      break;
    }
    lastCacheablePrefixIndex = sectionIndex;
  }

  return normalizedSections.slice(0, lastCacheablePrefixIndex + 1).map((section, sectionIndex) => ({
    type: 'text',
    text: section.text,
    ...(sectionIndex === lastCacheablePrefixIndex
      ? { cache_control: ANTHROPIC_EPHEMERAL_CACHE_CONTROL }
      : {}),
  }));
}

export function reorderAnthropicToolsForCaching(tools: ToolDefinition[]): {
  orderedTools: ToolDefinition[];
  lastStablePrefixIndex: number;
} {
  return buildPromptCachingToolOrder(tools);
}

export function simplifyAnthropicSchema(
  schema: Record<string, any>,
  options: { strict: boolean },
): Record<string, any> {
  if (!schema || typeof schema !== 'object') return schema;

  const rawType = Array.isArray(schema.type)
    ? schema.type.find((entry: unknown) => typeof entry === 'string' && entry !== 'null')
    : schema.type;
  const normalizedType = typeof rawType === 'string' ? rawType : undefined;

  if (normalizedType === 'object' || schema.properties) {
    const propertyEntries = Object.entries((schema.properties || {}) as Record<string, any>);
    const properties: Record<string, any> = {};

    for (const [key, value] of propertyEntries) {
      properties[key] = simplifyAnthropicSchema(value as Record<string, any>, options);
    }

    const result: Record<string, any> = {
      type: 'object',
      properties,
    };
    if (typeof schema.description === 'string' && schema.description.length > 0) {
      result.description = schema.description;
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key: unknown) => typeof key === 'string' && key in properties)
      : [];
    if (required.length > 0) {
      result.required = required;
    }
    if (options.strict) {
      result.additionalProperties = false;
    } else if (schema.additionalProperties === false) {
      result.additionalProperties = false;
    } else if (schema.additionalProperties === true) {
      result.additionalProperties = true;
    }
    return result;
  }

  if (normalizedType === 'array' || schema.items) {
    const result: Record<string, any> = {
      type: 'array',
      items:
        schema.items && typeof schema.items === 'object'
          ? simplifyAnthropicSchema(schema.items as Record<string, any>, options)
          : {},
    };
    if (typeof schema.description === 'string' && schema.description.length > 0) {
      result.description = schema.description;
    }
    return result;
  }

  const result: Record<string, any> = {};
  if (normalizedType) {
    result.type = normalizedType;
  }
  if (typeof schema.description === 'string' && schema.description.length > 0) {
    result.description = schema.description;
  }
  if (Array.isArray(schema.enum)) {
    result.enum = schema.enum;
  }
  return Object.keys(result).length > 0 ? result : { type: 'string' };
}
