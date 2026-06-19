import type { ToolDefinition } from '../../../../types/tool';
import type { SystemPromptSection } from '../../support/contracts';
import {
  normalizeSystemPromptSections,
  splitCacheableSystemPromptSections,
} from '../../core/systemPromptSections';
import { buildPromptCachingToolOrder } from '../../core/toolCaching';

export const MAX_ANTHROPIC_STRICT_TOOLS = 4;
export const ANTHROPIC_INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';
export const ANTHROPIC_EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const;

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
  if (trimmed.length <= 2000) return trimmed;
  return `${trimmed.slice(0, 1997).trimEnd()}...`;
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

function collectAnthropicSchemaStats(
  schema: Record<string, any>,
  depth = 0,
): {
  propertyCount: number;
  nestedStructureCount: number;
  maxDepth: number;
  enumValueCount: number;
} {
  if (!schema || typeof schema !== 'object') {
    return {
      propertyCount: 0,
      nestedStructureCount: 0,
      maxDepth: depth,
      enumValueCount: 0,
    };
  }

  const rawType = Array.isArray(schema.type)
    ? schema.type.find((entry: unknown) => typeof entry === 'string' && entry !== 'null')
    : schema.type;
  const normalizedType = typeof rawType === 'string' ? rawType : undefined;
  const enumValueCount = Array.isArray(schema.enum) ? schema.enum.length : 0;

  if (normalizedType === 'object' || schema.properties) {
    let propertyCount = 0;
    let nestedStructureCount = 0;
    let maxDepth = depth;

    for (const value of Object.values((schema.properties || {}) as Record<string, any>)) {
      propertyCount += 1;
      const child = collectAnthropicSchemaStats(value as Record<string, any>, depth + 1);
      propertyCount += child.propertyCount;
      nestedStructureCount += child.nestedStructureCount;
      maxDepth = Math.max(maxDepth, child.maxDepth);
      if (
        value &&
        typeof value === 'object' &&
        ((value as Record<string, any>).properties || (value as Record<string, any>).items)
      ) {
        nestedStructureCount += 1;
      }
      nestedStructureCount += Array.isArray((value as Record<string, any>)?.enum)
        ? ((value as Record<string, any>).enum as unknown[]).length
        : 0;
    }

    return {
      propertyCount,
      nestedStructureCount,
      maxDepth,
      enumValueCount,
    };
  }

  if (normalizedType === 'array' || schema.items) {
    const child = collectAnthropicSchemaStats(schema.items as Record<string, any>, depth + 1);
    return {
      propertyCount: child.propertyCount,
      nestedStructureCount: child.nestedStructureCount + 1,
      maxDepth: Math.max(depth, child.maxDepth),
      enumValueCount: enumValueCount + child.enumValueCount,
    };
  }

  return {
    propertyCount: 0,
    nestedStructureCount: 0,
    maxDepth: depth,
    enumValueCount,
  };
}

export function isAnthropicStrictEligible(schema: Record<string, any>): boolean {
  const stats = collectAnthropicSchemaStats(schema);
  return (
    stats.propertyCount <= 3 &&
    stats.nestedStructureCount === 0 &&
    stats.maxDepth <= 1 &&
    stats.enumValueCount <= 6
  );
}
