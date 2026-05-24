// ---------------------------------------------------------------------------
// Kavi — LLM Service
// ---------------------------------------------------------------------------
// Supports any OpenAI-compatible API endpoint (OpenAI, Anthropic via proxy,
// OpenRouter, Ollama, etc.) with streaming responses.

import {
  AssistantCompletionMetadata,
  AssistantCompletionStatus,
  LlmProviderConfig,
  MessageProviderReplay,
  ModelCapabilities,
  TokenUsage,
  ToolDefinition,
} from '../../types';
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  inferModelCapabilities,
  isVertexNativeGeminiBaseUrl,
  normalizeGeminiBaseUrl,
} from '../../constants/api';
import { fetch as expoFetch } from 'expo/fetch';
import { normalizeUsage } from '../usage/tracker';
import { normalizeOpenAIPromptCacheKey } from '../context/tokenOptimization';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import { normalizeToolInputSchema } from '../../utils/toolSchema';
import { createTimeoutSignal } from '../../utils/runtime';
import {
  getSelectableLocalLlmModels,
  isOnDeviceLlmProvider,
  sendLocalLlmMessage,
  streamLocalLlmMessage,
} from '../localLlm/runtime';

/**
 * Recursively add `additionalProperties: false` to all object-type schemas.
 * Required by Anthropic's `strict: true` grammar-constrained sampling.
 */
function strictifySchema(schema: Record<string, any>): Record<string, any> {
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

// Anthropic strict tool use compiles the aggregate strict schemas up front.
// Keep the first request conservative so streaming starts immediately instead
// of paying for a predictable 400 "Schema too complex" retry.
const MAX_ANTHROPIC_STRICT_TOOLS = 4;
const ANTHROPIC_INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';
const GEMINI_DUMMY_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';
const ANTHROPIC_EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const;
const ANTHROPIC_CACHEABLE_TOOL_PREFIX_NAMES = new Set([
  'read_file',
  'write_file',
  'list_files',
  'javascript',
  'python',
  'record_workflow_evidence',
  'read_workflow_evidence',
  'file_edit',
  'tool_catalog',
]);

type SystemPromptSection = {
  text: string;
  cacheable?: boolean;
};

type GeminiPromptCacheEntry =
  | {
      status: 'ready';
      cachedContent: string;
      expireTimeMs?: number;
    }
  | {
      status: 'failed';
      retryAfter: number;
    };

const geminiPromptCacheEntries = new Map<string, GeminiPromptCacheEntry>();
const GEMINI_PROMPT_CACHE_DEFAULT_TTL = '3600s';
const GEMINI_PROMPT_CACHE_FAILURE_BACKOFF_MS = 10 * 60_000;
const GEMINI_PROMPT_CACHE_REFRESH_WINDOW_MS = 30_000;

function simplifyAnthropicToolDescription(description: string | undefined): string {
  // Anthropic best practice: "Provide extremely detailed descriptions.
  // This is by far the most important factor in tool performance."
  // Keep full descriptions — truncate only at a very generous safety cap.
  const trimmed = (description || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 2000) return trimmed;
  return `${trimmed.slice(0, 1997).trimEnd()}...`;
}

function normalizeSystemPromptSections(
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

function splitCacheableSystemPromptSections(
  sections: SystemPromptSection[] | undefined,
): { cacheableText?: string; dynamicText?: string } {
  const normalizedSections = normalizeSystemPromptSections(sections);
  if (!normalizedSections?.length) {
    return {};
  }

  const cacheableSections = normalizedSections
    .filter((section) => section.cacheable)
    .map((section) => section.text);
  const dynamicSections = normalizedSections
    .filter((section) => !section.cacheable)
    .map((section) => section.text);

  return {
    ...(cacheableSections.length > 0 ? { cacheableText: cacheableSections.join('\n\n') } : {}),
    ...(dynamicSections.length > 0 ? { dynamicText: dynamicSections.join('\n\n') } : {}),
  };
}

function fnv1aHash(value: string, seed = 0x811c9dc5): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function buildGeminiPromptCacheEntryKey(args: {
  conversationId?: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
}): string {
  const scope = typeof args.conversationId === 'string' ? args.conversationId.trim() : '';
  const material = JSON.stringify({
    scope,
    baseUrl: args.baseUrl,
    model: args.model,
    systemPrompt: args.systemPrompt,
  });
  return `${fnv1aHash(material)}:${fnv1aHash(`${material}\u0000${material.length}`, 0x9e3779b1)}`;
}

function parseGeminiPromptCacheExpireTime(expireTime: unknown): number | undefined {
  if (typeof expireTime !== 'string' || expireTime.trim().length === 0) {
    return undefined;
  }

  const timestamp = Date.parse(expireTime);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function buildGeminiPromptCacheModel(baseUrl: string, model: string): string {
  const normalizedModel = model
    .replace(/^models\//i, '')
    .replace(/^publishers\/[^/]+\/models\//i, '')
    .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//i, '')
    .trim();

  return isVertexNativeGeminiBaseUrl(baseUrl)
    ? `publishers/google/models/${normalizedModel}`
    : `models/${normalizedModel}`;
}

function resolveGeminiCachedContentHandle(rawValue: unknown): string | undefined {
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  return /(^|\/)cachedContents\//.test(trimmed) ? trimmed : undefined;
}

async function ensureGeminiPromptCache(args: {
  baseUrl: string;
  model: string;
  conversationId?: string;
  systemPrompt: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<string | undefined> {
  const systemPrompt = args.systemPrompt.trim();
  if (!systemPrompt) {
    return undefined;
  }

  const cacheKey = buildGeminiPromptCacheEntryKey({
    conversationId: args.conversationId,
    baseUrl: args.baseUrl,
    model: args.model,
    systemPrompt,
  });
  const now = Date.now();
  const existingEntry = geminiPromptCacheEntries.get(cacheKey);

  if (existingEntry?.status === 'failed' && existingEntry.retryAfter > now) {
    return undefined;
  }

  if (existingEntry?.status === 'ready') {
    if (!existingEntry.expireTimeMs || existingEntry.expireTimeMs - now > GEMINI_PROMPT_CACHE_REFRESH_WINDOW_MS) {
      return existingEntry.cachedContent;
    }
  }

  const response = await args.fetchImpl(`${args.baseUrl}/cachedContents`, {
    method: 'POST',
    headers: args.headers,
    body: JSON.stringify({
      model: buildGeminiPromptCacheModel(args.baseUrl, args.model),
      ttl: GEMINI_PROMPT_CACHE_DEFAULT_TTL,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    }),
    signal: args.signal,
  });

  if (!response.ok) {
    geminiPromptCacheEntries.set(cacheKey, {
      status: 'failed',
      retryAfter: now + GEMINI_PROMPT_CACHE_FAILURE_BACKOFF_MS,
    });
    return undefined;
  }

  const json = (await response.json()) as { name?: unknown; expireTime?: unknown };
  const cachedContent = resolveGeminiCachedContentHandle(json.name);
  if (!cachedContent) {
    geminiPromptCacheEntries.set(cacheKey, {
      status: 'failed',
      retryAfter: now + GEMINI_PROMPT_CACHE_FAILURE_BACKOFF_MS,
    });
    return undefined;
  }

  const expireTimeMs = parseGeminiPromptCacheExpireTime(json.expireTime);

  geminiPromptCacheEntries.set(cacheKey, {
    status: 'ready',
    cachedContent,
    ...(expireTimeMs ? { expireTimeMs } : {}),
  });

  return cachedContent;
}

export function resetGeminiPromptCacheForTests(): void {
  geminiPromptCacheEntries.clear();
}

function buildAnthropicSystemPromptContent(args: {
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

  const lastCacheableIndex = normalizedSections.reduce(
    (index, section, sectionIndex) => (section.cacheable ? sectionIndex : index),
    -1,
  );

  return normalizedSections.map((section, sectionIndex) => ({
    type: 'text',
    text: section.text,
    ...(sectionIndex === lastCacheableIndex ? { cache_control: ANTHROPIC_EPHEMERAL_CACHE_CONTROL } : {}),
  }));
}

function reorderAnthropicToolsForCaching(tools: ToolDefinition[]): {
  orderedTools: ToolDefinition[];
  lastStablePrefixIndex: number;
} {
  const stablePrefixTools: ToolDefinition[] = [];
  const dynamicTools: ToolDefinition[] = [];

  for (const tool of tools) {
    if (ANTHROPIC_CACHEABLE_TOOL_PREFIX_NAMES.has(tool.name)) {
      stablePrefixTools.push(tool);
      continue;
    }

    dynamicTools.push(tool);
  }

  return {
    orderedTools: [...stablePrefixTools, ...dynamicTools],
    lastStablePrefixIndex: stablePrefixTools.length - 1,
  };
}

function reorderToolsForPromptCaching(tools: ToolDefinition[]): ToolDefinition[] {
  const stablePrefixTools: ToolDefinition[] = [];
  const dynamicTools: ToolDefinition[] = [];

  for (const tool of tools) {
    if (ANTHROPIC_CACHEABLE_TOOL_PREFIX_NAMES.has(tool.name)) {
      stablePrefixTools.push(tool);
      continue;
    }

    dynamicTools.push(tool);
  }

  if (stablePrefixTools.length === 0 || dynamicTools.length === 0) {
    return tools;
  }

  return [...stablePrefixTools, ...dynamicTools];
}

/**
 * Preserve detailed Gemini tool descriptions.
 * Gemini function calling performs better when descriptions include purpose,
 * invocation conditions, and parameter semantics.
 */
function simplifyGeminiToolDescription(description: string | undefined): string {
  const trimmed = (description || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 2000) return trimmed;
  return `${trimmed.slice(0, 1997).trimEnd()}...`;
}

function simplifyAnthropicSchema(
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
      items: schema.items && typeof schema.items === 'object'
        ? simplifyAnthropicSchema(schema.items as Record<string, any>, options)
        : {},
    };
    if (typeof schema.description === 'string' && schema.description.length > 0) {
      result.description = schema.description;
    }
    return result;
  }

  // Preserve description and key constraints for leaf properties —
  // Anthropic relies on property descriptions to understand parameter semantics.
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
): { propertyCount: number; nestedStructureCount: number; maxDepth: number; enumValueCount: number } {
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

function isAnthropicStrictEligible(schema: Record<string, any>): boolean {
  const stats = collectAnthropicSchemaStats(schema);
  return stats.propertyCount <= 3 && stats.nestedStructureCount === 0 && stats.maxDepth <= 1 && stats.enumValueCount <= 6;
}

function makeSchemaNullable(schema: Record<string, any>): Record<string, any> {
  const result = { ...schema };

  if (Array.isArray(result.type)) {
    if (!result.type.includes('null')) {
      result.type = [...result.type, 'null'];
    }
  } else if (typeof result.type === 'string' && result.type.length > 0 && result.type !== 'null') {
    result.type = [result.type, 'null'];
  }

  if (Array.isArray(result.enum) && !result.enum.includes(null)) {
    result.enum = [...result.enum, null];
  }

  return result;
}

/**
 * OpenAI strict mode requires every object to set additionalProperties=false and
 * every property to be listed in required. Optional fields become nullable.
 */
function strictifyOpenAiSchema(schema: Record<string, any>): Record<string, any> {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  if (result.type === 'object') {
    const originalRequired = new Set(Array.isArray(result.required) ? result.required : []);
    const propertyEntries = Object.entries((result.properties || {}) as Record<string, any>);
    const nextProperties: Record<string, any> = {};

    for (const [key, value] of propertyEntries) {
      const child = strictifyOpenAiSchema(value as Record<string, any>);
      nextProperties[key] = originalRequired.has(key) ? child : makeSchemaNullable(child);
    }

    result.properties = nextProperties;
    result.required = propertyEntries.map(([key]) => key);
    result.additionalProperties = false;
  }

  if (result.items && typeof result.items === 'object') {
    result.items = strictifyOpenAiSchema(result.items);
  }

  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.map((entry: Record<string, any>) => strictifyOpenAiSchema(entry));
  }

  if (Array.isArray(result.oneOf)) {
    result.oneOf = result.oneOf.map((entry: Record<string, any>) => strictifyOpenAiSchema(entry));
  }

  if (Array.isArray(result.allOf)) {
    result.allOf = result.allOf.map((entry: Record<string, any>) => strictifyOpenAiSchema(entry));
  }

  return result;
}

function normalizeSchemaTypeList(typeValue: unknown): string[] {
  if (Array.isArray(typeValue)) {
    return Array.from(new Set(
      typeValue.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0),
    ));
  }

  if (typeof typeValue === 'string' && typeValue.trim().length > 0) {
    return [typeValue.trim()];
  }

  return [];
}

function appendSchemaConstraintDescription(schema: Record<string, any>, constraintText: string): void {
  const currentDescription = typeof schema.description === 'string' ? schema.description.trim() : '';
  if (currentDescription.includes(constraintText)) {
    return;
  }

  schema.description = currentDescription.length > 0
    ? `${currentDescription} ${constraintText}`
    : constraintText;
}

function dedupeSchemaVariants(variants: Record<string, any>[]): Record<string, any>[] {
  const seen = new Set<string>();
  const deduped: Record<string, any>[] = [];

  for (const variant of variants) {
    const serialized = JSON.stringify(variant);
    if (seen.has(serialized)) {
      continue;
    }

    seen.add(serialized);
    deduped.push(variant);
  }

  return deduped;
}

function normalizeGeminiNullableType(schema: Record<string, any>): void {
  const normalizedTypes = normalizeSchemaTypeList(schema.type);
  if (normalizedTypes.length === 0) {
    return;
  }

  const nonNullTypes = normalizedTypes.filter((entry) => entry !== 'null');
  const hasNull = nonNullTypes.length !== normalizedTypes.length;

  if (nonNullTypes.length === 1) {
    schema.type = nonNullTypes[0];
    if (hasNull) {
      schema.nullable = true;
    }
    return;
  }

  if (nonNullTypes.length > 1) {
    schema.type = nonNullTypes[0];
    if (hasNull) {
      schema.nullable = true;
    }
    appendSchemaConstraintDescription(schema, `Allowed types: ${normalizedTypes.join(', ')}.`);
    return;
  }

  schema.type = 'string';
}

const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set([
  'patternProperties',
  'propertyNames',
  'dependencies',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedProperties',
  'contains',
  'prefixItems',
  'not',
  'if',
  'then',
  'else',
]);

function isStrictCompatibleSchema(
  schema: Record<string, any>,
  depth = 0,
): boolean {
  if (!schema || typeof schema !== 'object') {
    return true;
  }

  const normalizedTypes = normalizeSchemaTypeList(schema.type);
  if (normalizedTypes.length > 0) {
    const nonNullTypes = normalizedTypes.filter((entry) => entry !== 'null');
    if (nonNullTypes.length > 1) {
      return false;
    }
  }

  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (schema[key] !== undefined) {
      return false;
    }
  }

  if (depth === 0) {
    if (
      schema.anyOf !== undefined
      || schema.oneOf !== undefined
      || schema.allOf !== undefined
      || schema.enum !== undefined
    ) {
      return false;
    }
  }

  if (schema.oneOf !== undefined || schema.allOf !== undefined) {
    return false;
  }

  if (schema.type === 'object' || schema.properties !== undefined || schema.additionalProperties !== undefined) {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
      return false;
    }

    const rawProperties = schema.properties;
    if (rawProperties === undefined) {
      return depth === 0;
    }

    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      return false;
    }

    const propertyEntries = Object.entries(rawProperties as Record<string, any>);
    if (depth > 0 && propertyEntries.length === 0 && schema.additionalProperties !== false) {
      return false;
    }

    if (!propertyEntries.every(([, value]) => isStrictCompatibleSchema(value as Record<string, any>, depth + 1))) {
      return false;
    }
  }

  if (schema.items !== undefined) {
    if (!schema.items || typeof schema.items !== 'object' || Array.isArray(schema.items)) {
      return false;
    }
    if (!isStrictCompatibleSchema(schema.items as Record<string, any>, depth + 1)) {
      return false;
    }
  }

  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      return false;
    }
    if (!(schema.anyOf as Record<string, any>[]).every((entry) => isStrictCompatibleSchema(entry, depth + 1))) {
      return false;
    }
  }

  return true;
}

function cleanGeminiSchema(schema: Record<string, any>): Record<string, any> {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  // Strip fields that are noisy or unsupported by Gemini function declarations.
  delete result.default;
  delete result.examples;
  delete result.$schema;
  delete result.$id;
  delete result.$ref;
  delete result.additionalProperties;

  normalizeGeminiNullableType(result);

  if (Array.isArray(result.enum)) {
    const normalizedType = typeof result.type === 'string' ? result.type.toLowerCase() : '';
    const allStringEnumValues = result.enum.every((value: unknown) => typeof value === 'string');

    // Gemini's native Schema proto only accepts string enums on STRING types.
    // Preserve unsupported enum constraints as description hints instead of
    // forwarding invalid parameter declarations that 400.
    if (normalizedType !== 'string' || !allStringEnumValues) {
      const allowedValues = result.enum
        .map((value: unknown) => {
          if (typeof value === 'string') {
            return value;
          }
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);

      if (allowedValues.length > 0) {
        appendSchemaConstraintDescription(result, `Allowed values: ${allowedValues.join(', ')}.`);
      }

      delete result.enum;
    }
  }

  if ('properties' in result) {
    const rawProperties = result.properties;
    if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
      result.properties = {};
    } else {
      result.properties = Object.fromEntries(
        Object.entries(rawProperties as Record<string, any>).map(([key, value]) => [
          key,
          cleanGeminiSchema(value as Record<string, any>),
        ]),
      );
    }
  }

  if (Array.isArray(result.required)) {
    const propertyKeys = result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)
      ? new Set(Object.keys(result.properties as Record<string, any>))
      : null;
    const filteredRequired = result.required.filter(
      (key: unknown): key is string => typeof key === 'string' && (!propertyKeys || propertyKeys.has(key)),
    );

    if (filteredRequired.length > 0) {
      result.required = filteredRequired;
    } else {
      delete result.required;
    }
  }

  if (result.items && typeof result.items === 'object') {
    result.items = cleanGeminiSchema(result.items as Record<string, any>);
  }

  if (Array.isArray(result.anyOf)) {
    result.anyOf = dedupeSchemaVariants(
      result.anyOf.map((entry: Record<string, any>) => cleanGeminiSchema(entry)),
    );
  }

  if (Array.isArray(result.oneOf)) {
    const oneOfVariants = result.oneOf.map((entry: Record<string, any>) => cleanGeminiSchema(entry));
    result.anyOf = dedupeSchemaVariants([
      ...(Array.isArray(result.anyOf) ? result.anyOf : []),
      ...oneOfVariants,
    ]);
    delete result.oneOf;
  }

  if (Array.isArray(result.allOf)) {
    appendSchemaConstraintDescription(result, 'All composed constraints from the original schema still apply.');
    delete result.allOf;
  }

  return result;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStructuredOutputOptions(value: unknown): StructuredOutputOptions | undefined {
  if (!isPlainRecord(value) || !isPlainRecord(value.schema)) {
    return undefined;
  }

  const mimeType = typeof value.mimeType === 'string' && value.mimeType.trim().length > 0
    ? value.mimeType.trim()
    : 'application/json';
  const name = typeof value.name === 'string' && value.name.trim().length > 0
    ? value.name.trim()
    : undefined;

  return {
    schema: normalizeToolInputSchema(value.schema),
    mimeType,
    ...(name ? { name } : {}),
    ...(typeof value.strict === 'boolean' ? { strict: value.strict } : {}),
  };
}

function normalizeGeminiMessageContent(value: unknown): string | any[] {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return '';
  }
  return String(value);
}

type StreamTextExtraction = {
  content: string;
  reasoning: string;
};

function extractOpenAiCompatibleTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractOpenAiCompatibleTextValue(entry)).join('');
  }

  if (!isPlainRecord(value)) {
    return '';
  }

  if (typeof value.text === 'string') {
    return value.text;
  }
  if (typeof value.output_text === 'string') {
    return value.output_text;
  }
  if (typeof value.refusal === 'string') {
    return value.refusal;
  }
  if (typeof value.reasoning_content === 'string') {
    return value.reasoning_content;
  }

  return '';
}

function extractStructuredStreamTextPart(part: unknown): StreamTextExtraction {
  if (typeof part === 'string') {
    return { content: part, reasoning: '' };
  }

  if (!isPlainRecord(part)) {
    return { content: '', reasoning: '' };
  }

  const type = typeof part.type === 'string' ? part.type : '';
  const text = extractOpenAiCompatibleTextValue(part);

  if (typeof part.reasoning_content === 'string' && part.reasoning_content.length > 0) {
    return { content: '', reasoning: part.reasoning_content };
  }

  if (part.thought === true || /^(?:reasoning(?:_summary)?_text|reasoning|thinking|thought)$/.test(type)) {
    return { content: '', reasoning: text };
  }

  if (type === 'refusal') {
    return { content: text, reasoning: '' };
  }

  return { content: text, reasoning: '' };
}

function extractOpenAiCompatibleStreamText(value: unknown): StreamTextExtraction {
  if (typeof value === 'string') {
    return { content: value, reasoning: '' };
  }

  if (Array.isArray(value)) {
    let content = '';
    let reasoning = '';

    for (const part of value) {
      const extracted = extractStructuredStreamTextPart(part);
      content += extracted.content;
      reasoning += extracted.reasoning;
    }

    return { content, reasoning };
  }

  return extractStructuredStreamTextPart(value);
}

function trimGeminiCumulativeText(fullContent: string, incoming: string): string {
  if (!incoming || !fullContent) {
    return incoming;
  }

  return incoming.startsWith(fullContent)
    ? incoming.slice(fullContent.length)
    : incoming;
}

function getSharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function mergeStreamedArgumentText(existing: string, incoming: string): string {
  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  if (incoming === existing || existing.startsWith(incoming)) {
    return existing;
  }

  const trimmedExisting = existing.trimStart();
  const trimmedIncoming = incoming.trimStart();
  const sharedJsonStart = trimmedExisting[0] === trimmedIncoming[0]
    && (trimmedExisting[0] === '{' || trimmedExisting[0] === '[');

  if (sharedJsonStart) {
    const sharedPrefixLength = getSharedPrefixLength(trimmedExisting, trimmedIncoming);
    const shorterLength = Math.min(trimmedExisting.length, trimmedIncoming.length);
    const likelyCumulativeSnapshot = sharedPrefixLength >= Math.max(2, Math.floor(shorterLength * 0.6));

    if (likelyCumulativeSnapshot) {
      return trimmedIncoming.length >= trimmedExisting.length ? incoming : existing;
    }
  }

  return incoming.startsWith(existing)
    ? incoming
    : `${existing}${incoming}`;
}

type ChatCompletionMessage = {
  role: string;
  content: string | any[];
  tool_call_id?: string;
  name?: string;
  [key: string]: any;
};

function extractGeminiHistoryText(value: unknown): string {
  const normalized = normalizeGeminiMessageContent(value);
  if (typeof normalized === 'string') {
    return normalized;
  }
  if (!Array.isArray(normalized)) {
    return String(normalized ?? '');
  }

  return normalized
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (isPlainRecord(entry)) {
        if (typeof entry.text === 'string') {
          return entry.text;
        }
        if (entry.type === 'image_url') {
          return '[image]';
        }
      }
      try {
        return JSON.stringify(entry);
      } catch {
        return String(entry);
      }
    })
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    .join('\n');
}

function summarizeGeminiHistoryText(value: unknown, maxChars: number): string {
  const flattened = extractGeminiHistoryText(value).replace(/\s+/g, ' ').trim();
  if (!flattened) {
    return '';
  }
  if (flattened.length <= maxChars) {
    return flattened;
  }
  const ellipsis = '... [truncated]';
  return `${flattened.slice(0, Math.max(0, maxChars - ellipsis.length)).trimEnd()}${ellipsis}`;
}

function parseGeminiJsonLikeText(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"'))) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeGeminiToolName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractGeminiThoughtSignature(value: unknown): string | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const thoughtSignature = typeof value.thoughtSignature === 'string'
    ? value.thoughtSignature
    : typeof value.thought_signature === 'string'
      ? value.thought_signature
      : undefined;

  if (typeof thoughtSignature !== 'string') {
    return undefined;
  }

  const trimmed = thoughtSignature.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeGeminiToolCall(toolCall: unknown): Record<string, any> | null {
  if (!isPlainRecord(toolCall)) {
    return null;
  }

  const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
  const type = typeof toolCall.type === 'string' && toolCall.type.length > 0
    ? toolCall.type
    : 'function';
  const rawFunction = isPlainRecord(toolCall.function) ? toolCall.function : undefined;
  const name = typeof rawFunction?.name === 'string' ? rawFunction.name.trim() : '';
  const args = typeof rawFunction?.arguments === 'string'
    ? rawFunction.arguments
    : JSON.stringify(rawFunction?.arguments ?? {});

  if (!id || !name) {
    return null;
  }

  const sanitized: Record<string, any> = {
    id,
    type,
    function: {
      name,
      arguments: args,
    },
  };

  // Preserve extra_content (including real or documented dummy
  // thought_signature values) so buildGeminiConversation can either replay the
  // exact Gemini step or use Google's documented validation bypass for
  // synthetic current-turn history when exact metadata is unavailable.
  const extraContent = isPlainRecord(toolCall.extra_content)
    ? { ...toolCall.extra_content }
    : undefined;

  if (extraContent && Object.keys(extraContent).length > 0) {
    sanitized.extra_content = extraContent;
  }

  return sanitized;
}

function extractGeminiToolCallThoughtSignature(toolCall: unknown): string | undefined {
  const sanitized = sanitizeGeminiToolCall(toolCall);
  if (!sanitized) {
    return undefined;
  }

  const thoughtSignature = isPlainRecord(sanitized.extra_content?.google)
    && typeof sanitized.extra_content.google.thought_signature === 'string'
    ? sanitized.extra_content.google.thought_signature
    : undefined;

  if (typeof thoughtSignature !== 'string') {
    return undefined;
  }

  const trimmed = thoughtSignature.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type StreamedToolCall = {
  id: string;
  name: string;
  arguments: string;
  raw?: Record<string, any>;
};

type StreamEvent = {
  type: 'token' | 'reasoning' | 'tool_call' | 'done' | 'usage';
  content?: string;
  toolCall?: StreamedToolCall;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number };
  providerReplay?: MessageProviderReplay;
  completion?: AssistantCompletionMetadata;
};

function mergeStreamToolCallChunk(
  existing: StreamedToolCall,
  chunk: Record<string, any>,
): StreamedToolCall {
  const nextRaw: Record<string, any> = isPlainRecord(existing.raw)
    ? { ...existing.raw }
    : {};

  if (typeof chunk.id === 'string' && chunk.id.length > 0) {
    nextRaw.id = chunk.id;
  }

  if (typeof chunk.type === 'string' && chunk.type.length > 0) {
    nextRaw.type = chunk.type;
  }

  if (chunk.extra_content !== undefined) {
    nextRaw.extra_content = chunk.extra_content;
  }

  const functionChunk = isPlainRecord(chunk.function) ? chunk.function : undefined;
  if (functionChunk) {
    const nextFunction = isPlainRecord(nextRaw.function)
      ? { ...nextRaw.function }
      : {};

    for (const [key, value] of Object.entries(functionChunk)) {
      if (value === undefined) continue;
      if (key === 'arguments' && typeof value === 'string') {
        nextFunction.arguments = mergeStreamedArgumentText(
          typeof nextFunction.arguments === 'string' ? nextFunction.arguments : '',
          value,
        );
      } else {
        nextFunction[key] = value;
      }
    }

    nextRaw.function = nextFunction;
  }

  return {
    id: typeof nextRaw.id === 'string' && nextRaw.id.length > 0 ? nextRaw.id : existing.id,
    name: typeof nextRaw.function?.name === 'string' && nextRaw.function.name.length > 0
      ? nextRaw.function.name
      : existing.name,
    arguments: typeof nextRaw.function?.arguments === 'string'
      ? nextRaw.function.arguments
      : existing.arguments,
    ...(Object.keys(nextRaw).length > 0 ? { raw: nextRaw } : {}),
  };
}

function getStreamedToolCallSignature(toolCall: StreamedToolCall): string {
  return [
    toolCall.id,
    toolCall.name,
    toolCall.arguments,
    toolCall.raw ? JSON.stringify(toolCall.raw) : '',
  ].join('\u0001');
}

function getEmittableStreamedToolCall(
  toolCalls: Record<number, StreamedToolCall>,
  emittedToolCallSignatures: Map<number, string>,
  index: number,
): StreamedToolCall | undefined {
  const toolCall = toolCalls[index];
  if (!toolCall || !toolCall.id || !toolCall.name) {
    return undefined;
  }

  const signature = getStreamedToolCallSignature(toolCall);
  if (emittedToolCallSignatures.get(index) === signature) {
    return undefined;
  }

  emittedToolCallSignatures.set(index, signature);
  return toolCall;
}

function createCompletionMetadata(
  completionStatus: AssistantCompletionStatus,
  finishReason?: string,
): AssistantCompletionMetadata {
  return {
    completionStatus,
    ...(finishReason ? { finishReason } : {}),
  };
}

function normalizeOpenAiCompatibleCompletion(reason: unknown): AssistantCompletionMetadata | undefined {
  if (typeof reason !== 'string') {
    return undefined;
  }

  const normalizedReason = reason.trim().toLowerCase();
  if (!normalizedReason) {
    return undefined;
  }

  if (
    normalizedReason === 'stop'
    || normalizedReason === 'tool_calls'
    || normalizedReason === 'tool_call'
    || normalizedReason === 'stop_sequence'
    || normalizedReason === 'end_turn'
  ) {
    return createCompletionMetadata('complete', normalizedReason);
  }

  return createCompletionMetadata('incomplete', normalizedReason);
}

function normalizeGeminiCompletion(reason: unknown): AssistantCompletionMetadata | undefined {
  if (typeof reason !== 'string') {
    return undefined;
  }

  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    return undefined;
  }

  const upperReason = normalizedReason.toUpperCase();
  if (upperReason === 'STOP' || upperReason === 'STOP_SEQUENCE' || upperReason === 'TOOL_CALL') {
    return createCompletionMetadata('complete', normalizedReason);
  }

  return createCompletionMetadata('incomplete', normalizedReason);
}

function normalizeAnthropicCompletion(reason: unknown): AssistantCompletionMetadata | undefined {
  if (typeof reason !== 'string') {
    return undefined;
  }

  const normalizedReason = reason.trim().toLowerCase();
  if (!normalizedReason) {
    return undefined;
  }

  if (normalizedReason === 'end_turn' || normalizedReason === 'tool_use') {
    return createCompletionMetadata('complete', normalizedReason);
  }

  return createCompletionMetadata('incomplete', normalizedReason);
}

export interface ModelsWithCapabilities {
  models: string[];
  capabilities: Record<string, ModelCapabilities>;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onReasoning?: (token: string) => void;
  onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
  onDone: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

interface PromptCachingOptions {
  enablePromptCaching?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: 'in_memory' | 'in-memory' | '24h';
}

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type AnthropicEffort = 'low' | 'medium' | 'high' | 'max';
type AnthropicOutputConfig = {
  effort?: AnthropicEffort;
  format?: Record<string, any>;
  [key: string]: unknown;
};
type StructuredOutputOptions = {
  schema: Record<string, any>;
  mimeType?: string;
  name?: string;
  strict?: boolean;
};

interface MessageRequestOptions extends PromptCachingOptions {
  conversationId?: string;
  model?: string;
  tools?: ToolDefinition[];
  systemPromptSections?: SystemPromptSection[];
  toolChoice?: ToolChoiceMode;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  reasoning_effort?: ReasoningEffort;
  thinking?: Record<string, unknown>;
  output_config?: AnthropicOutputConfig;
  structuredOutput?: StructuredOutputOptions;
}

export interface GeneratedImagePayload {
  model: string;
  b64_json?: string;
  url?: string;
  revisedPrompt?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  usage?: TokenUsage;
}

type ImageEditPayloadSource = {
  uri: string;
  name?: string;
  mimeType?: string;
  dataUri?: string;
};

type ToolChoiceMode = 'auto' | 'required' | {
  type: 'required';
  disableParallelToolUse?: boolean;
} | {
  type: 'tool';
  name: string;
  disableParallelToolUse?: boolean;
};

type ProviderTransport = 'anthropic' | 'gemini' | 'openai' | 'compatible' | 'local';

type GeminiImageSizeValue = '512' | '1K' | '2K' | '4K';

const GEMINI_IMAGE_ASPECT_RATIOS = new Set([
  '1:1',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);

const GEMINI_IMAGE_SIZE_VALUES = new Set<GeminiImageSizeValue>(['512', '1K', '2K', '4K']);

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a || 1;
}

export class LlmService {
  private config: LlmProviderConfig;

  constructor(config: LlmProviderConfig) {
    this.config = config;
  }

  private isOnDeviceProvider(): boolean {
    return isOnDeviceLlmProvider(this.config);
  }

  private isAnthropicProvider(): boolean {
    const base = (this.config.baseUrl || '').toLowerCase();
    return base.includes('anthropic.com');
  }

  private isOpenAIProvider(): boolean {
    const base = (this.config.baseUrl || '').toLowerCase();
    return /(^|\/\/)(api\.)?openai\.com(\/|$)/.test(base);
  }

  private isGeminiProvider(): boolean {
    const base = (this.config.baseUrl || '').toLowerCase();
    return base.includes('generativelanguage.googleapis.com') || /(^|\b)(google|gemini)(\b|$)/.test((this.config.name || '').toLowerCase());
  }

  private isGeminiModel(model: string): boolean {
    return model.toLowerCase().includes('gemini');
  }

  private getProviderTransport(): ProviderTransport {
    if (this.isOnDeviceProvider()) {
      return 'local';
    }
    if (this.isAnthropicProvider()) {
      return 'anthropic';
    }
    if (this.isGeminiProvider()) {
      return 'gemini';
    }
    if (this.isOpenAIProvider()) {
      return 'openai';
    }
    return 'compatible';
  }

  private isOpenAIReasoningModel(model: string): boolean {
    const lower = model.toLowerCase();
    return lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4') || lower.startsWith('gpt-5');
  }

  private shouldSurfaceReasoning(_model: string): boolean {
    return true;
  }

  private normalizeOpenAIPromptCacheRetention(
    retention?: PromptCachingOptions['promptCacheRetention'],
  ): 'in_memory' | '24h' {
    return retention === '24h' ? '24h' : 'in_memory';
  }

  private toOpenAIResponsesMessageContent(value: unknown): string | any[] {
    const normalized = normalizeGeminiMessageContent(value);

    if (typeof normalized === 'string') {
      return normalized;
    }

    if (!Array.isArray(normalized)) {
      if (normalized == null) {
        return '';
      }
      return String(normalized);
    }

    const parts = normalized.flatMap((entry): any[] => {
      if (typeof entry === 'string') {
        return entry.length > 0 ? [{ type: 'input_text', text: entry }] : [];
      }

      if (!isPlainRecord(entry)) {
        const text = entry == null ? '' : String(entry);
        return text.length > 0 ? [{ type: 'input_text', text }] : [];
      }

      if (entry.type === 'input_text' && typeof entry.text === 'string') {
        return entry.text.length > 0 ? [{ ...entry }] : [];
      }

      if (entry.type === 'text' && typeof entry.text === 'string') {
        return entry.text.length > 0 ? [{ type: 'input_text', text: entry.text }] : [];
      }

      if (entry.type === 'input_image') {
        const imageUrl = typeof entry.image_url === 'string' ? entry.image_url : undefined;
        const fileId = typeof entry.file_id === 'string' ? entry.file_id : undefined;
        if (!imageUrl && !fileId) {
          return [];
        }
        return [{
          type: 'input_image',
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(fileId ? { file_id: fileId } : {}),
          ...(typeof entry.detail === 'string' ? { detail: entry.detail } : {}),
        }];
      }

      if (entry.type === 'image_url') {
        const imageUrl = isPlainRecord(entry.image_url) ? entry.image_url.url : entry.image_url;
        const detail = isPlainRecord(entry.image_url) ? entry.image_url.detail : undefined;
        if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
          return [];
        }
        return [{
          type: 'input_image',
          image_url: imageUrl,
          ...(typeof detail === 'string' ? { detail } : {}),
        }];
      }

      if (entry.type === 'input_file' || entry.type === 'file') {
        const fileId = typeof entry.file_id === 'string' ? entry.file_id : undefined;
        const fileData = typeof entry.file_data === 'string' ? entry.file_data : undefined;
        const filename = typeof entry.filename === 'string' ? entry.filename : undefined;
        if (!fileId && !fileData) {
          return [];
        }
        return [{
          type: 'input_file',
          ...(fileId ? { file_id: fileId } : {}),
          ...(fileData ? { file_data: fileData } : {}),
          ...(filename ? { filename } : {}),
        }];
      }

      try {
        return [{ type: 'input_text', text: JSON.stringify(entry) }];
      } catch {
        return [{ type: 'input_text', text: String(entry) }];
      }
    });

    if (parts.length === 0) {
      return '';
    }

    if (parts.length === 1 && parts[0].type === 'input_text') {
      return parts[0].text;
    }

    return parts;
  }

  private toOpenAIResponsesText(value: unknown): string {
    const content = this.toOpenAIResponsesMessageContent(value);
    if (typeof content === 'string') {
      return content;
    }

    return content
      .map((part) => {
        if (!isPlainRecord(part)) {
          return String(part ?? '');
        }
        if (part.type === 'input_text' && typeof part.text === 'string') {
          return part.text;
        }
        if (part.type === 'input_image') {
          return '[image]';
        }
        try {
          return JSON.stringify(part);
        } catch {
          return String(part);
        }
      })
      .filter((entry) => typeof entry === 'string' && entry.length > 0)
      .join('\n');
  }

  private getOpenAIReasoningItemsFromToolCalls(toolCalls: Record<string, any>[]): Record<string, any>[] {
    const items: Record<string, any>[] = [];
    const seen = new Set<string>();

    for (const toolCall of toolCalls) {
      const metadata = isPlainRecord(toolCall._openai) ? toolCall._openai : undefined;
      const reasoningItems = Array.isArray(metadata?.reasoningItems)
        ? metadata.reasoningItems.filter((item: unknown): item is Record<string, any> => isPlainRecord(item))
        : [];

      for (const item of reasoningItems) {
        const key = typeof item.id === 'string' && item.id.length > 0
          ? item.id
          : JSON.stringify(item);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push(item);
      }
    }

    return items;
  }

  private getOpenAIReasoningTextParts(item: Record<string, any>): Array<{ key: string; text: string }> {
    const itemKey = typeof item.id === 'string' && item.id.length > 0
      ? item.id
      : JSON.stringify(item);
    const parts: Array<{ key: string; text: string }> = [];

    const summaryParts = Array.isArray(item.summary)
      ? item.summary.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
      : [];
    summaryParts.forEach((part, index) => {
      if (typeof part.text === 'string' && part.text.length > 0) {
        parts.push({ key: `summary:${itemKey}:${index}`, text: part.text });
      }
    });

    const contentParts = Array.isArray(item.content)
      ? item.content.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
      : [];
    contentParts.forEach((part, index) => {
      if (typeof part.text === 'string' && part.text.length > 0) {
        parts.push({ key: `reasoning:${itemKey}:${index}`, text: part.text });
      }
    });

    if (parts.length === 0 && typeof item.text === 'string' && item.text.length > 0) {
      parts.push({ key: `reasoning:${itemKey}:text`, text: item.text });
    }

    return parts;
  }

  private extractOpenAIReplayFunctionCallIds(output: Record<string, any>[]): Set<string> {
    const ids = new Set<string>();

    for (const item of output) {
      if (item.type !== 'function_call') {
        continue;
      }

      const callId = typeof item.call_id === 'string' && item.call_id.trim().length > 0
        ? item.call_id.trim()
        : typeof item.id === 'string' && item.id.trim().length > 0
          ? item.id.trim()
          : '';

      if (callId) {
        ids.add(callId);
      }
    }

    return ids;
  }

  private getOpenAIReplayFunctionCallItems(output: Record<string, any>[]): Record<string, any>[] {
    return output.filter((item) => item.type === 'function_call');
  }

  private getOpenAIReplayItemKey(item: Record<string, any>): string {
    return typeof item.id === 'string' && item.id.trim().length > 0
      ? item.id.trim()
      : JSON.stringify(item);
  }

  private extractOpenAIReplayReasoningKeys(output: Record<string, any>[]): Set<string> {
    const keys = new Set<string>();

    for (const item of output) {
      if (item.type !== 'reasoning') {
        continue;
      }

      keys.add(this.getOpenAIReplayItemKey(item));
    }

    return keys;
  }

  private replayedOpenAIOutputCoversToolCalls(
    replayOutput: Record<string, any>[],
    toolCalls: Record<string, any>[],
    options: { requireReasoningItemsForFunctionCalls?: boolean } = {},
  ): boolean {
    const replayFunctionCalls = this.getOpenAIReplayFunctionCallItems(replayOutput);
    if (toolCalls.length === 0 && replayFunctionCalls.length === 0) {
      return true;
    }

    const replayCallIds = this.extractOpenAIReplayFunctionCallIds(replayFunctionCalls);
    if (replayCallIds.size === 0) {
      return false;
    }

    const requiredReasoningItems = this.getOpenAIReasoningItemsFromToolCalls(toolCalls);
    const replayReasoningKeys = options.requireReasoningItemsForFunctionCalls || requiredReasoningItems.length > 0
      ? this.extractOpenAIReplayReasoningKeys(replayOutput)
      : undefined;

    if (options.requireReasoningItemsForFunctionCalls && replayFunctionCalls.length > 0) {
      if (!replayReasoningKeys || replayReasoningKeys.size === 0) {
        return false;
      }
    }

    if (requiredReasoningItems.length > 0) {
      if (!replayReasoningKeys || replayReasoningKeys.size === 0) {
        return false;
      }

      if (replayReasoningKeys.size === 0) {
        return false;
      }

      for (const reasoningItem of requiredReasoningItems) {
        if (!replayReasoningKeys.has(this.getOpenAIReplayItemKey(reasoningItem))) {
          return false;
        }
      }
    }

    return toolCalls.every((toolCall) => {
      const item = this.buildOpenAIResponseFunctionCallItem(toolCall);
      return !!item && typeof item.call_id === 'string' && replayCallIds.has(item.call_id);
    });
  }

  private getOpenAIHistoricalFunctionCallDescriptor(
    toolCall: Record<string, any>,
  ): { callId: string; name: string; argumentsText: string } | null {
    if (toolCall.type === 'function_call') {
      const callId = typeof toolCall.call_id === 'string' && toolCall.call_id.trim().length > 0
        ? toolCall.call_id.trim()
        : typeof toolCall.id === 'string' && toolCall.id.trim().length > 0
          ? toolCall.id.trim()
          : '';
      const name = typeof toolCall.name === 'string' ? toolCall.name.trim() : '';
      if (!callId || !name) {
        return null;
      }

      return {
        callId,
        name,
        argumentsText: typeof toolCall.arguments === 'string'
          ? toolCall.arguments
          : JSON.stringify(toolCall.arguments ?? {}),
      };
    }

    const normalized = this.buildOpenAIResponseFunctionCallItem(toolCall);
    if (normalized && typeof normalized.call_id === 'string' && typeof normalized.name === 'string') {
      return {
        callId: normalized.call_id,
        name: normalized.name,
        argumentsText: typeof normalized.arguments === 'string'
          ? normalized.arguments
          : JSON.stringify(normalized.arguments ?? {}),
      };
    }

    const functionCall = isPlainRecord(toolCall.function) ? toolCall.function : undefined;
    const callId = typeof toolCall.id === 'string' && toolCall.id.trim().length > 0 ? toolCall.id.trim() : '';
    const name = typeof functionCall?.name === 'string' ? functionCall.name.trim() : '';
    if (!callId || !name) {
      return null;
    }

    return {
      callId,
      name,
      argumentsText: typeof functionCall?.arguments === 'string'
        ? functionCall.arguments
        : JSON.stringify(functionCall?.arguments ?? {}),
    };
  }

  private buildOpenAIHistoricalToolTurnSummary(
    message: ChatCompletionMessage,
    toolCalls: Record<string, any>[],
  ): string {
    const lines: string[] = [];
    const assistantText = this.toOpenAIResponsesText(message.content).trim();
    if (assistantText.length > 0) {
      lines.push(assistantText);
    }

    if (toolCalls.length > 0) {
      lines.push(
        `Historical tool ${toolCalls.length === 1 ? 'call' : 'calls'} from a previous completed turn (exact OpenAI replay unavailable):`,
      );
      for (const toolCall of toolCalls) {
        const descriptor = this.getOpenAIHistoricalFunctionCallDescriptor(toolCall);
        if (!descriptor) {
          continue;
        }
        lines.push(`- ${descriptor.name} ${descriptor.argumentsText}`);
      }
    }

    return lines.join('\n');
  }

  private buildOpenAIHistoricalToolResultSummary(toolName: string, content: unknown): string {
    const output = this.toOpenAIResponsesText(content).trim() || 'No output.';
    return `Historical tool result from ${toolName} (exact OpenAI replay unavailable):\n${output}`;
  }

  private extractOpenAIReasoningText(items: Record<string, any>[]): string {
    return items
      .flatMap((item) => this.getOpenAIReasoningTextParts(item).map((part) => part.text.trim()))
      .filter((text) => text.length > 0)
      .join('\n\n');
  }

  private buildOpenAIResponseFunctionCallItem(toolCall: Record<string, any>): Record<string, any> | null {
    const functionCall = isPlainRecord(toolCall.function) ? toolCall.function : undefined;
    const metadata = isPlainRecord(toolCall._openai) ? toolCall._openai : undefined;
    const name = typeof functionCall?.name === 'string' ? functionCall.name.trim() : '';
    const callId = typeof metadata?.callId === 'string' && metadata.callId.trim().length > 0
      ? metadata.callId.trim()
      : (typeof toolCall.id === 'string' ? toolCall.id.trim() : '');

    if (!callId || !name) {
      return null;
    }

    const argumentsText = typeof functionCall?.arguments === 'string'
      ? functionCall.arguments
      : JSON.stringify(functionCall?.arguments ?? {});

    const item: Record<string, any> = {
      type: 'function_call',
      call_id: callId,
      name,
      arguments: argumentsText,
      status: 'completed',
    };

    const itemId = typeof metadata?.itemId === 'string' && metadata.itemId.trim().length > 0
      ? metadata.itemId.trim()
      : '';
    if (itemId) {
      item.id = itemId;
    }

    return item;
  }

  private getOpenAIResponseIdFromMessage(message: ChatCompletionMessage): string {
    const providerReplay = isPlainRecord(message.providerReplay) ? message.providerReplay : undefined;
    if (typeof providerReplay?.openaiResponseId === 'string' && providerReplay.openaiResponseId.trim().length > 0) {
      return providerReplay.openaiResponseId.trim();
    }

    if (typeof message.openaiResponseId === 'string' && message.openaiResponseId.trim().length > 0) {
      return message.openaiResponseId.trim();
    }

    return '';
  }

  private getOpenAIResponsesContinuation(
    messages: ChatCompletionMessage[],
  ): { previousResponseId?: string; replayStartIndex: number } {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== 'assistant') {
        continue;
      }

      const previousResponseId = this.getOpenAIResponseIdFromMessage(message);
      if (!previousResponseId) {
        return { replayStartIndex: 0 };
      }

      return {
        previousResponseId,
        replayStartIndex: index + 1,
      };
    }

    return { replayStartIndex: 0 };
  }

  private buildOpenAIResponsesInput(
    messages: ChatCompletionMessage[],
    model: string = this.config.model,
  ): { instructions?: string; input: Array<Record<string, any>>; previousResponseId?: string } {
    const instructionsParts: string[] = [];
    const input: Array<Record<string, any>> = [];
    const emittedReasoningItems = new Set<string>();
    const downgradedToolCallNames = new Map<string, string>();
    const requireReasoningItemsForFunctionCalls = this.isOpenAIReasoningModel(model);
    const continuation = this.getOpenAIResponsesContinuation(messages);

    const hasMessageContent = (content: string | any[]): boolean => {
      if (typeof content === 'string') {
        return content.trim().length > 0;
      }
      return content.length > 0;
    };

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role === 'system') {
        const text = this.toOpenAIResponsesText(message.content).trim();
        if (text.length > 0) {
          instructionsParts.push(text);
        }
        continue;
      }

      if (index < continuation.replayStartIndex) {
        continue;
      }

      if (message.role === 'tool') {
        const callId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
        if (!callId) {
          continue;
        }

        const downgradedToolName = downgradedToolCallNames.get(callId);
        if (downgradedToolName) {
          input.push({
            role: 'assistant',
            content: this.buildOpenAIHistoricalToolResultSummary(downgradedToolName, message.content),
          });
          continue;
        }

        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: this.toOpenAIResponsesText(message.content) || 'No output.',
        });
        continue;
      }

      const toolCalls = message.role === 'assistant' && Array.isArray((message as any).tool_calls)
        ? (message as any).tool_calls
          .filter((toolCall: unknown): toolCall is Record<string, any> => isPlainRecord(toolCall))
        : [];
      const replayOutput = message.role === 'assistant' && Array.isArray(message.providerReplay?.openaiResponseOutput)
        ? message.providerReplay.openaiResponseOutput
          .filter((item: unknown): item is Record<string, any> => isPlainRecord(item))
        : [];
      const replayFunctionCalls = this.getOpenAIReplayFunctionCallItems(replayOutput);

      if (message.role === 'assistant' && replayOutput.length > 0) {
        const canUseReplayOutput = replayOutput.length > 0
          && this.replayedOpenAIOutputCoversToolCalls(replayOutput, toolCalls, {
            requireReasoningItemsForFunctionCalls,
          });

        if (canUseReplayOutput) {
          for (const item of replayOutput) {
            if (item.type === 'reasoning') {
              const key = typeof item.id === 'string' && item.id.length > 0
                ? item.id
                : JSON.stringify(item);
              if (emittedReasoningItems.has(key)) {
                continue;
              }
              emittedReasoningItems.add(key);
            }

            input.push(item);
          }
          continue;
        }
      }

      if (message.role === 'assistant' && toolCalls.length > 0) {
        const reasoningItems = this.getOpenAIReasoningItemsFromToolCalls(toolCalls);
        if (reasoningItems.length > 0) {
          for (const item of reasoningItems) {
            const key = typeof item.id === 'string' && item.id.length > 0
              ? item.id
              : JSON.stringify(item);
            if (emittedReasoningItems.has(key)) {
              continue;
            }
            emittedReasoningItems.add(key);
            input.push(item);
          }

          const assistantContent = this.toOpenAIResponsesMessageContent(message.content);
          if (hasMessageContent(assistantContent)) {
            input.push({ role: 'assistant', content: assistantContent });
          }

          for (const toolCall of toolCalls) {
            const item = this.buildOpenAIResponseFunctionCallItem(toolCall);
            if (item) {
              input.push(item);
            }
          }
          continue;
        }

        const summary = this.buildOpenAIHistoricalToolTurnSummary(message, toolCalls);
        if (summary.length > 0) {
          input.push({ role: 'assistant', content: summary });
        }

        for (const toolCall of toolCalls) {
          const descriptor = this.getOpenAIHistoricalFunctionCallDescriptor(toolCall);
          if (!descriptor) {
            continue;
          }
          downgradedToolCallNames.set(descriptor.callId, descriptor.name);
        }
        continue;
      }

      if (message.role === 'assistant' && replayFunctionCalls.length > 0) {
        const summary = this.buildOpenAIHistoricalToolTurnSummary(message, replayFunctionCalls);
        if (summary.length > 0) {
          input.push({ role: 'assistant', content: summary });
        }

        for (const toolCall of replayFunctionCalls) {
          const descriptor = this.getOpenAIHistoricalFunctionCallDescriptor(toolCall);
          if (!descriptor) {
            continue;
          }
          downgradedToolCallNames.set(descriptor.callId, descriptor.name);
        }
        continue;
      }

      const content = this.toOpenAIResponsesMessageContent(message.content);
      if (message.role === 'assistant' && !hasMessageContent(content)) {
        continue;
      }

      input.push({
        role: message.role,
        content,
      });
    }

    return {
      ...(instructionsParts.length > 0 ? { instructions: instructionsParts.join('\n\n') } : {}),
      input,
      ...(continuation.previousResponseId ? { previousResponseId: continuation.previousResponseId } : {}),
    };
  }

  private buildOpenAIResponsesToolDefinition(tool: ToolDefinition): Record<string, any> {
    const normalizedSchema = normalizeToolInputSchema(tool.input_schema);
    const useStrict = tool.strict !== false && isStrictCompatibleSchema(normalizedSchema);
    return {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: useStrict ? strictifyOpenAiSchema(normalizedSchema) : normalizedSchema,
      strict: useStrict,
    };
  }

  private buildOpenAIResponsesTextFormat(structuredOutput: StructuredOutputOptions): Record<string, any> {
    const normalizedSchema = normalizeToolInputSchema(structuredOutput.schema);
    const useStrict = structuredOutput.strict !== false && isStrictCompatibleSchema(normalizedSchema);
    return {
      type: 'json_schema',
      name: structuredOutput.name || 'structured_output',
      schema: useStrict ? strictifyOpenAiSchema(normalizedSchema) : normalizedSchema,
      strict: useStrict,
    };
  }

  private buildCompatibleStructuredOutputFormat(structuredOutput: StructuredOutputOptions): Record<string, any> {
    const normalizedSchema = normalizeToolInputSchema(structuredOutput.schema);
    const useStrict = structuredOutput.strict !== false && isStrictCompatibleSchema(normalizedSchema);

    return {
      type: 'json_schema',
      json_schema: {
        name: structuredOutput.name || 'structured_output',
        schema: useStrict ? strictifyOpenAiSchema(normalizedSchema) : normalizedSchema,
        strict: useStrict,
      },
    };
  }

  private buildAnthropicStructuredOutputFormat(structuredOutput: StructuredOutputOptions): Record<string, any> {
    const normalizedSchema = normalizeToolInputSchema(structuredOutput.schema);
    return {
      type: 'json_schema',
      schema: simplifyAnthropicSchema(strictifySchema(normalizedSchema), { strict: true }),
    };
  }

  private buildAnthropicOutputConfig(options: MessageRequestOptions): AnthropicOutputConfig | undefined {
    const explicitOutputConfig = this.normalizeAnthropicOutputConfig(options.output_config);
    const structuredOutput = normalizeStructuredOutputOptions(options.structuredOutput);

    if (!explicitOutputConfig && !structuredOutput) {
      return undefined;
    }

    const outputConfig: AnthropicOutputConfig = explicitOutputConfig ? { ...explicitOutputConfig } : {};

    if (structuredOutput) {
      outputConfig.format = this.buildAnthropicStructuredOutputFormat(structuredOutput);
    }

    return Object.keys(outputConfig).length > 0 ? outputConfig : undefined;
  }

  private buildOpenAIResponsesBody(
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ): Record<string, any> {
    const responsesInput = this.buildOpenAIResponsesInput(messages, model);
    const body: Record<string, any> = {
      model,
      instructions: responsesInput.instructions,
      input: responsesInput.input,
      stream: options.stream ?? false,
    };

    if (responsesInput.previousResponseId) {
      body.previous_response_id = responsesInput.previousResponseId;
    }

    if (options.maxTokens) {
      body.max_output_tokens = options.maxTokens;
    }

    if (options.temperature !== undefined && this.supportsTemperature(model)) {
      body.temperature = options.temperature;
    }

    if (options.reasoning_effort && this.isOpenAIReasoningModel(model)) {
      body.reasoning = { effort: options.reasoning_effort, summary: 'auto' };
    }

    if (this.isOpenAIReasoningModel(model)) {
      body.include = ['reasoning.encrypted_content'];
    }

    const structuredOutput = normalizeStructuredOutputOptions(options.structuredOutput);
    if (structuredOutput) {
      body.text = {
        format: this.buildOpenAIResponsesTextFormat(structuredOutput),
      };
    }

    const requestTools = options.tools?.length && options.enablePromptCaching
      ? reorderToolsForPromptCaching(options.tools)
      : options.tools;

    if (requestTools?.length) {
      body.tools = requestTools.map((tool) => this.buildOpenAIResponsesToolDefinition(tool));
      const toolChoice = this.buildOpenAIToolChoice(options.toolChoice);
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
      if (this.shouldDisableParallelToolUse(options.toolChoice)) {
        body.parallel_tool_calls = false;
      }
    }

    if (options.enablePromptCaching) {
      const promptCacheKey = normalizeOpenAIPromptCacheKey(options.promptCacheKey);
      if (promptCacheKey) {
        body.prompt_cache_key = promptCacheKey;
      }
      body.prompt_cache_retention = this.normalizeOpenAIPromptCacheRetention(options.promptCacheRetention);
    }

    return body;
  }

  private buildOpenAIResponseToolRaw(
    item: Record<string, any>,
    context: { outputIndex?: number; reasoningItems?: Record<string, any>[] } = {},
  ): Record<string, any> {
    const callId = typeof item.call_id === 'string' && item.call_id.trim().length > 0
      ? item.call_id.trim()
      : (typeof item.id === 'string' ? item.id.trim() : '');
    const argumentsText = typeof item.arguments === 'string'
      ? item.arguments
      : JSON.stringify(item.arguments ?? {});

    const raw: Record<string, any> = {
      id: callId,
      type: 'function',
      function: {
        name: typeof item.name === 'string' ? item.name : '',
        arguments: argumentsText,
      },
    };

    const openAiMetadata: Record<string, any> = {};
    if (typeof item.id === 'string' && item.id.trim().length > 0) {
      openAiMetadata.itemId = item.id.trim();
    }
    if (callId) {
      openAiMetadata.callId = callId;
    }
    if (typeof context.outputIndex === 'number') {
      openAiMetadata.outputIndex = context.outputIndex;
    }
    if (Array.isArray(context.reasoningItems) && context.reasoningItems.length > 0) {
      openAiMetadata.reasoningItems = context.reasoningItems;
    }
    if (Object.keys(openAiMetadata).length > 0) {
      raw._openai = openAiMetadata;
    }

    return raw;
  }

  private mergeOpenAIStreamToolCall(
    existing: StreamedToolCall | undefined,
    raw: Record<string, any>,
  ): StreamedToolCall {
    const nextRaw: Record<string, any> = isPlainRecord(existing?.raw) ? { ...existing.raw } : {};

    if (typeof raw.id === 'string' && raw.id.length > 0) {
      nextRaw.id = raw.id;
    }

    if (typeof raw.type === 'string' && raw.type.length > 0) {
      nextRaw.type = raw.type;
    }

    if (isPlainRecord(raw._openai)) {
      nextRaw._openai = {
        ...(isPlainRecord(nextRaw._openai) ? nextRaw._openai : {}),
        ...raw._openai,
      };
    }

    if (isPlainRecord(raw.function)) {
      const nextFunction = isPlainRecord(nextRaw.function) ? { ...nextRaw.function } : {};
      if (typeof raw.function.name === 'string' && raw.function.name.length > 0) {
        nextFunction.name = raw.function.name;
      }
      if (typeof raw.function.arguments === 'string') {
        nextFunction.arguments = raw.function.arguments;
      }
      nextRaw.function = nextFunction;
    }

    return {
      id: typeof nextRaw.id === 'string' && nextRaw.id.length > 0 ? nextRaw.id : existing?.id || '',
      name: typeof nextRaw.function?.name === 'string' && nextRaw.function.name.length > 0
        ? nextRaw.function.name
        : existing?.name || '',
      arguments: typeof nextRaw.function?.arguments === 'string'
        ? nextRaw.function.arguments
        : existing?.arguments || '',
      ...(Object.keys(nextRaw).length > 0 ? { raw: nextRaw } : {}),
    };
  }

  private normalizeOpenAIResponsesUsage(usage: any): Record<string, any> | undefined {
    const normalizedUsage = normalizeUsage(usage);
    if (!normalizedUsage) {
      return undefined;
    }

    const normalized: Record<string, any> = {
      prompt_tokens: normalizedUsage.inputTokens,
      completion_tokens: normalizedUsage.outputTokens,
      total_tokens: normalizedUsage.totalTokens,
      prompt_tokens_details: {
        cached_tokens: normalizedUsage.cacheReadTokens,
        ...(normalizedUsage.cacheWriteTokens > 0
          ? { cache_write_tokens: normalizedUsage.cacheWriteTokens }
          : {}),
      },
      output_tokens_details: usage.output_tokens_details ?? usage.outputTokensDetails ?? {},
    };

    if (normalizedUsage.cacheReadTokens > 0) {
      normalized.cache_read_input_tokens = normalizedUsage.cacheReadTokens;
    }

    if (normalizedUsage.cacheWriteTokens > 0) {
      normalized.cache_creation_input_tokens = normalizedUsage.cacheWriteTokens;
    }

    return normalized;
  }

  private attachProviderResponse(
    result: any,
    provider: 'anthropic' | 'gemini' | 'openai-responses',
    response: any,
  ): any {
    if (!isPlainRecord(result)) {
      return result;
    }

    return {
      ...result,
      providerResponse: {
        provider,
        response,
      },
    };
  }

  private normalizeOpenAIResponsesResult(json: any): any {
    const output = Array.isArray(json?.output)
      ? json.output.filter((item: unknown): item is Record<string, any> => isPlainRecord(item))
      : [];
    const responseId = typeof json?.id === 'string' && json.id.trim().length > 0
      ? json.id.trim()
      : '';
    const reasoningItems = output.filter((item: Record<string, any>) => item.type === 'reasoning');
    const reasoning = this.extractOpenAIReasoningText(reasoningItems);

    const toolCalls: Array<Record<string, any>> = [];
    output.forEach((item: Record<string, any>, outputIndex: number) => {
      if (item.type !== 'function_call') {
        return;
      }
      const raw = this.buildOpenAIResponseToolRaw(item, { outputIndex, reasoningItems });
      toolCalls.push({
        id: raw.id,
        type: 'function',
        index: toolCalls.length,
        function: { ...raw.function },
        raw,
      });
    });

    let content = typeof json?.output_text === 'string' ? json.output_text : '';
    if (!content) {
      const contentParts: string[] = [];
      for (const item of output) {
        if (item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
          continue;
        }

        for (const part of item.content) {
          if (!isPlainRecord(part)) {
            continue;
          }
          if (part.type === 'output_text' && typeof part.text === 'string') {
            contentParts.push(part.text);
          }
          if (part.type === 'refusal' && typeof part.refusal === 'string') {
            contentParts.push(part.refusal);
          }
        }
      }
      content = contentParts.join('');
    }

    const usage = this.normalizeOpenAIResponsesUsage(json?.usage);
    return {
      ...(responseId ? { id: responseId } : {}),
      choices: [{
        message: {
          role: 'assistant',
          content,
          ...(reasoning ? { reasoning } : {}),
          ...((output.length > 0 || responseId)
            ? {
              providerReplay: {
                ...(responseId ? { openaiResponseId: responseId } : {}),
                ...(output.length > 0 ? { openaiResponseOutput: output } : {}),
              },
            }
            : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0
          ? 'tool_calls'
          : json?.status === 'incomplete'
            ? 'length'
            : 'stop',
      }],
      ...(usage ? { usage } : {}),
    };
  }

  private async sendOpenAIResponsesMessage(
    baseUrl: string,
    headers: Record<string, string>,
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ): Promise<any> {
    const body = this.buildOpenAIResponsesBody(model, messages, options);
    const requestHeaders = options.stream
      ? { ...headers, Accept: 'text/event-stream' }
      : headers;

    const response = await this.performFetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.stream ?? false);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`LLM API error ${response.status}: ${errorText}`);
    }

    if (options.stream) {
      return response;
    }

    const json = await response.json();
    return this.attachProviderResponse(this.normalizeOpenAIResponsesResult(json), 'openai-responses', json);
  }

  private supportsTemperature(model: string): boolean {
    if (!this.isOpenAIProvider()) return true;
    return !this.isOpenAIReasoningModel(model);
  }

  private isExactToolChoice(choice: ToolChoiceMode | undefined): choice is Extract<ToolChoiceMode, { type: 'tool' }> {
    return isPlainRecord(choice) && choice.type === 'tool' && typeof choice.name === 'string' && choice.name.trim().length > 0;
  }

  private isRequiredToolChoice(choice: ToolChoiceMode | undefined): choice is Extract<ToolChoiceMode, { type: 'required' }> {
    return isPlainRecord(choice) && choice.type === 'required';
  }

  private isForcedToolChoice(choice: ToolChoiceMode | undefined): boolean {
    return choice === 'required' || this.isRequiredToolChoice(choice) || this.isExactToolChoice(choice);
  }

  private shouldDisableParallelToolUse(choice: ToolChoiceMode | undefined): boolean {
    return (this.isExactToolChoice(choice) || this.isRequiredToolChoice(choice))
      && choice.disableParallelToolUse === true;
  }

  private buildOpenAIToolChoice(choice: ToolChoiceMode | undefined): Record<string, any> | string | undefined {
    if (!choice) {
      return undefined;
    }

    if (this.isExactToolChoice(choice)) {
      return {
        type: 'function',
        name: choice.name.trim(),
      };
    }

    if (choice === 'required' || this.isRequiredToolChoice(choice)) {
      return 'required';
    }

    return choice;
  }

  private buildCompatibleToolChoice(choice: ToolChoiceMode | undefined): Record<string, any> | string | undefined {
    if (!choice) {
      return undefined;
    }

    if (this.isExactToolChoice(choice)) {
      return {
        type: 'function',
        function: {
          name: choice.name.trim(),
        },
      };
    }

    if (choice === 'required' || this.isRequiredToolChoice(choice)) {
      return 'required';
    }

    return choice;
  }

  private buildAnthropicToolChoice(choice: ToolChoiceMode | undefined): Record<string, any> | undefined {
    if (!choice) {
      return undefined;
    }

    if (this.isExactToolChoice(choice)) {
      return {
        type: 'tool',
        name: choice.name.trim(),
        ...(choice.disableParallelToolUse === true ? { disable_parallel_tool_use: true } : {}),
      };
    }

    if (choice === 'required' || this.isRequiredToolChoice(choice)) {
      return {
        type: 'any',
        ...(this.shouldDisableParallelToolUse(choice)
          ? { disable_parallel_tool_use: true }
          : {}),
      };
    }

    return { type: 'auto' };
  }

  private buildGeminiFunctionCallingConfig(choice: ToolChoiceMode | undefined): Record<string, any> | undefined {
    if (!choice) {
      return {
        mode: 'AUTO',
      };
    }

    if (this.isExactToolChoice(choice)) {
      return {
        mode: 'ANY',
        allowedFunctionNames: [choice.name.trim()],
      };
    }

    return {
      mode: choice === 'required' || this.isRequiredToolChoice(choice) ? 'ANY' : 'AUTO',
    };
  }

  private supportsGeminiStructuredOutputWithTools(model: string): boolean {
    return model.toLowerCase().includes('gemini-3');
  }

  private getGeminiBaseUrl(): string {
    const configuredBaseUrl = (this.config.baseUrl || '').trim();
    return normalizeGeminiBaseUrl(configuredBaseUrl || DEFAULT_GEMINI_BASE_URL);
  }

  private getBaseUrl(): string {
    const configuredBaseUrl = (this.config.baseUrl || '').trim();
    const fallbackBaseUrl = DEFAULT_OPENAI_BASE_URL;
    if (this.isGeminiProvider()) {
      return this.getGeminiBaseUrl();
    }
    const normalizedBaseUrl = (configuredBaseUrl || fallbackBaseUrl).replace(/\/+$/, '');
    return normalizedBaseUrl || fallbackBaseUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = (this.config.apiKey || '').trim();
    const providerTransport = this.getProviderTransport();

    if (providerTransport === 'anthropic') {
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      headers['anthropic-version'] = '2023-06-01';
    } else if (providerTransport === 'gemini') {
      if (apiKey) {
        headers['x-goog-api-key'] = apiKey;
      }
    } else {
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['x-api-key'] = apiKey;
        headers['api-key'] = apiKey;
      }
    }
    return headers;
  }

  private async performFetch(
    url: string,
    init: RequestInit,
    preferStreaming = false,
  ): Promise<Response> {
    const request = preferStreaming ? expoFetch : fetch;
    return request(url, {
      ...init,
      credentials: init.credentials ?? 'omit',
    });
  }

  private stringifyAnthropicContent(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value == null) {
      return '';
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private anthropicContentIsEmpty(content: string | any[]): boolean {
    if (typeof content === 'string') {
      return content.length === 0;
    }
    return content.length === 0;
  }

  private anthropicContentToBlocks(content: string | any[]): any[] {
    if (typeof content === 'string') {
      return content.length > 0 ? [{ type: 'text', text: content }] : [];
    }

    return content.filter((block) => {
      if (!isPlainRecord(block)) {
        return true;
      }
      if (block.type !== 'text') {
        return true;
      }
      return typeof block.text === 'string' && block.text.length > 0;
    });
  }

  private orderAnthropicUserBlocks(blocks: any[]): any[] {
    if (blocks.length === 0) {
      return blocks;
    }

    const toolResults: any[] = [];
    const otherBlocks: any[] = [];

    for (const block of blocks) {
      if (isPlainRecord(block) && block.type === 'tool_result') {
        toolResults.push(block);
      } else {
        otherBlocks.push(block);
      }
    }

    return toolResults.length > 0
      ? [...toolResults, ...otherBlocks]
      : otherBlocks;
  }

  private mergeAnthropicContent(existing: string | any[], incoming: string | any[]): string | any[] {
    if (typeof existing === 'string' && typeof incoming === 'string') {
      return existing.length > 0 && incoming.length > 0
        ? `${existing}\n\n${incoming}`
        : `${existing}${incoming}`;
    }

    const mergedBlocks = this.orderAnthropicUserBlocks([
      ...this.anthropicContentToBlocks(existing),
      ...this.anthropicContentToBlocks(incoming),
    ]);

    if (mergedBlocks.length === 0) {
      return '';
    }

    return mergedBlocks.length === 1 && mergedBlocks[0]?.type === 'text'
      ? mergedBlocks[0].text
      : mergedBlocks;
  }

  private mergeAnthropicAssistantContent(existing: string | any[], incoming: string | any[]): string | any[] {
    const mergedBlocks = [
      ...this.anthropicContentToBlocks(existing),
      ...this.anthropicContentToBlocks(incoming),
    ];

    if (mergedBlocks.length === 0) {
      return '';
    }

    return mergedBlocks.length === 1 && mergedBlocks[0]?.type === 'text'
      ? mergedBlocks[0].text
      : mergedBlocks;
  }

  private collectAnthropicToolUseIds(content: string | any[]): Set<string> {
    const ids = new Set<string>();

    for (const block of this.anthropicContentToBlocks(content)) {
      if (!isPlainRecord(block) || block.type !== 'tool_use') {
        continue;
      }

      const id = typeof block.id === 'string' ? block.id.trim() : '';
      if (id) {
        ids.add(id);
      }
    }

    return ids;
  }

  private collectAnthropicToolResultIds(content: string | any[]): Set<string> {
    const ids = new Set<string>();

    for (const block of this.anthropicContentToBlocks(content)) {
      if (!isPlainRecord(block) || block.type !== 'tool_result') {
        continue;
      }

      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id.trim() : '';
      if (id) {
        ids.add(id);
      }
    }

    return ids;
  }

  private stripAnthropicToolUseBlocks(content: string | any[]): string | any[] {
    const blocks = this.anthropicContentToBlocks(content).filter(
      (block) => !isPlainRecord(block) || block.type !== 'tool_use',
    );

    if (blocks.length === 0) {
      return '';
    }

    return blocks.length === 1 && blocks[0]?.type === 'text'
      ? blocks[0].text
      : blocks;
  }

  private filterAnthropicUserToolResults(
    content: string | any[],
    allowedToolUseIds?: Set<string>,
  ): string | any[] {
    const blocks = this.anthropicContentToBlocks(content).filter((block) => {
      if (!isPlainRecord(block) || block.type !== 'tool_result') {
        return true;
      }

      const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id.trim() : '';
      return !!allowedToolUseIds && toolUseId.length > 0 && allowedToolUseIds.has(toolUseId);
    });

    const orderedBlocks = this.orderAnthropicUserBlocks(blocks);
    if (orderedBlocks.length === 0) {
      return '';
    }

    return orderedBlocks.length === 1 && orderedBlocks[0]?.type === 'text'
      ? orderedBlocks[0].text
      : orderedBlocks;
  }

  private normalizeAnthropicConversationHistory(
    messages: Array<{ role: string; content: string | any[] }>,
  ): Array<{ role: string; content: string | any[] }> {
    const normalized: Array<{ role: string; content: string | any[] }> = [];
    let pendingToolUseIds: Set<string> | null = null;
    let pendingAssistantIndex = -1;

    const pushMessage = (message: { role: string; content: string | any[] }) => {
      if (this.anthropicContentIsEmpty(message.content)) {
        return;
      }

      const lastMessage = normalized[normalized.length - 1];
      if (lastMessage?.role === message.role) {
        lastMessage.content = message.role === 'assistant'
          ? this.mergeAnthropicAssistantContent(lastMessage.content, message.content)
          : this.mergeAnthropicContent(lastMessage.content, message.content);
        return;
      }

      normalized.push(message);
    };

    const stripPendingAssistantToolUse = () => {
      if (pendingAssistantIndex < 0 || !pendingToolUseIds || pendingToolUseIds.size === 0) {
        pendingToolUseIds = null;
        pendingAssistantIndex = -1;
        return;
      }

      const assistantMessage = normalized[pendingAssistantIndex];
      if (!assistantMessage || assistantMessage.role !== 'assistant') {
        pendingToolUseIds = null;
        pendingAssistantIndex = -1;
        return;
      }

      assistantMessage.content = this.stripAnthropicToolUseBlocks(assistantMessage.content);
      if (this.anthropicContentIsEmpty(assistantMessage.content)) {
        normalized.splice(pendingAssistantIndex, 1);
      }

      pendingToolUseIds = null;
      pendingAssistantIndex = -1;
    };

    for (const message of messages) {
      if (message.role === 'assistant') {
        if (pendingToolUseIds) {
          stripPendingAssistantToolUse();
        }

        pushMessage({ ...message });

        const toolUseIds = this.collectAnthropicToolUseIds(message.content);
        if (toolUseIds.size > 0) {
          pendingToolUseIds = toolUseIds;
          pendingAssistantIndex = normalized.length - 1;
        }
        continue;
      }

      if (message.role === 'user') {
        if (pendingToolUseIds && pendingToolUseIds.size > 0) {
          const filteredContent = this.filterAnthropicUserToolResults(message.content, pendingToolUseIds);
          const matchedToolResultIds = this.collectAnthropicToolResultIds(filteredContent);
          const isSatisfied = Array.from(pendingToolUseIds).every((toolUseId) => matchedToolResultIds.has(toolUseId));

          if (!isSatisfied) {
            stripPendingAssistantToolUse();
            pushMessage({
              ...message,
              content: this.filterAnthropicUserToolResults(message.content),
            });
          } else {
            pushMessage({ ...message, content: filteredContent });
            pendingToolUseIds = null;
            pendingAssistantIndex = -1;
          }
          continue;
        }

        pushMessage({
          ...message,
          content: this.filterAnthropicUserToolResults(message.content),
        });
        continue;
      }

      if (pendingToolUseIds) {
        stripPendingAssistantToolUse();
      }
      pushMessage({ ...message });
    }

    if (pendingToolUseIds) {
      stripPendingAssistantToolUse();
    }

    return normalized.filter((message) => !this.anthropicContentIsEmpty(message.content));
  }

  private shouldIncludeAnthropicInterleavedThinkingBeta(
    model: string | undefined,
    options: MessageRequestOptions,
    thinking?: Record<string, unknown>,
  ): boolean {
    if (!thinking || !options.tools?.length) {
      return false;
    }

    const lower = (model || this.config.model || '').toLowerCase();
    if (!lower.includes('claude')) {
      return false;
    }

    const thinkingType = typeof thinking.type === 'string'
      ? thinking.type.toLowerCase()
      : '';

    if (/claude-opus-4(?:[.-]|$)/.test(lower)) {
      return false;
    }

    if (lower.includes('claude-sonnet-4-6')) {
      return thinkingType === 'enabled';
    }

    return /claude-(opus|sonnet)-4(?:[.-]|$)/.test(lower);
  }

  private parseAnthropicImageDataUrl(value: unknown): { mediaType: string; data: string } | null {
    const url = typeof value === 'string'
      ? value
      : isPlainRecord(value) && typeof value.url === 'string'
        ? value.url
        : '';

    if (!url) {
      return null;
    }

    const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (!match) {
      return null;
    }

    const mediaType = match[1].trim().toLowerCase();
    if (!mediaType.startsWith('image/')) {
      return null;
    }

    return {
      mediaType,
      data: match[2].replace(/\s+/g, ''),
    };
  }

  private getAnthropicAssistantBlocksFromRawToolCalls(toolCalls: unknown): any[] | undefined {
    if (!Array.isArray(toolCalls)) {
      return undefined;
    }

    for (const toolCall of toolCalls) {
      const rawToolCall = isPlainRecord((toolCall as any)?.raw)
        ? (toolCall as any).raw
        : isPlainRecord(toolCall)
          ? toolCall as Record<string, any>
          : undefined;
      const extraContent = isPlainRecord(rawToolCall?.extra_content)
        ? rawToolCall.extra_content
        : undefined;
      const anthropicContent = isPlainRecord(extraContent?.anthropic)
        ? extraContent.anthropic
        : undefined;
      const assistantBlocks = Array.isArray(anthropicContent?.assistant_blocks)
        ? anthropicContent.assistant_blocks
        : Array.isArray(anthropicContent?.assistantBlocks)
          ? anthropicContent.assistantBlocks
          : undefined;

      if (assistantBlocks && assistantBlocks.length > 0) {
        return assistantBlocks;
      }
    }

    return undefined;
  }

  private getAnthropicAssistantBlocksFromProviderReplay(providerReplay: unknown): any[] | undefined {
    const replay = isPlainRecord(providerReplay) ? providerReplay : undefined;
    const assistantBlocks = Array.isArray(replay?.anthropicBlocks)
      ? replay.anthropicBlocks
      : Array.isArray(replay?.anthropic_blocks)
        ? replay.anthropic_blocks
        : undefined;

    return assistantBlocks && assistantBlocks.length > 0 ? assistantBlocks : undefined;
  }

  private replayedAnthropicAssistantBlocksCoverToolCalls(
    replayBlocks: unknown[],
    toolCalls: unknown[],
  ): boolean {
    const expectedToolUseIds = new Set<string>();

    if (Array.isArray(toolCalls)) {
      for (const toolCall of toolCalls) {
        const id = typeof (toolCall as any)?.id === 'string' ? (toolCall as any).id.trim() : '';
        const name = typeof (toolCall as any)?.function?.name === 'string'
          ? (toolCall as any).function.name.trim()
          : '';
        if (id && name) {
          expectedToolUseIds.add(id);
        }
      }
    }

    const normalizedReplayBlocks = replayBlocks
      .map((block) => this.normalizeAnthropicAssistantBlock(block))
      .filter((block): block is Record<string, any> => Boolean(block));

    if (normalizedReplayBlocks.length === 0) {
      return false;
    }

    if (normalizedReplayBlocks.some((block) => block.type === 'thinking' && typeof block.signature !== 'string')) {
      return false;
    }

    if (expectedToolUseIds.size === 0) {
      return true;
    }

    const replayToolUseIds = new Set(
      normalizedReplayBlocks
        .filter((block) => block.type === 'tool_use' && typeof block.id === 'string')
        .map((block) => block.id as string),
    );

    if (replayToolUseIds.size === 0) {
      return false;
    }

    return Array.from(expectedToolUseIds).every((id) => replayToolUseIds.has(id));
  }

  private normalizeAnthropicAssistantBlock(block: unknown): Record<string, any> | null {
    if (typeof block === 'string') {
      const text = this.stringifyAnthropicContent(block);
      return text.length > 0 ? { type: 'text', text } : null;
    }

    if (!isPlainRecord(block)) {
      return null;
    }

    if (block.type === 'text') {
      const text = this.stringifyAnthropicContent(block.text);
      return text.length > 0 ? { type: 'text', text } : null;
    }

    if (block.type === 'thinking') {
      const normalized: Record<string, any> = {
        type: 'thinking',
        thinking: typeof block.thinking === 'string' ? block.thinking : '',
      };
      if (typeof block.signature === 'string' && block.signature.length > 0) {
        normalized.signature = block.signature;
      }
      return normalized;
    }

    if (block.type === 'redacted_thinking') {
      const data = typeof block.data === 'string' ? block.data : '';
      return data.length > 0
        ? { type: 'redacted_thinking', data }
        : null;
    }

    if (block.type === 'tool_use') {
      const id = typeof block.id === 'string' ? block.id.trim() : '';
      const name = typeof block.name === 'string' ? block.name.trim() : '';
      if (!id || !name) {
        return null;
      }

      const input = isPlainRecord(block.input)
        ? block.input
        : this.safeJsonParse(block.input);

      return {
        type: 'tool_use',
        id,
        name,
        input: isPlainRecord(input) ? input : {},
      };
    }

    return typeof block.type === 'string' && block.type.length > 0
      ? { ...block }
      : null;
  }

  private normalizeAnthropicAssistantBlocks(message: ChatCompletionMessage): any[] {
    const contentBlocks: any[] = [];
    const seenToolUseIds = new Set<string>();
    const toolCalls = Array.isArray((message as any).tool_calls)
      ? (message as any).tool_calls
      : [];
    const hasToolCalls = toolCalls.some((toolCall: any) => {
      const id = typeof toolCall?.id === 'string' ? toolCall.id.trim() : '';
      const name = typeof toolCall?.function?.name === 'string'
        ? toolCall.function.name.trim()
        : '';
      return id.length > 0 && name.length > 0;
    });
    const replayBlocks = this.getAnthropicAssistantBlocksFromProviderReplay((message as any).providerReplay)
      ?? this.getAnthropicAssistantBlocksFromRawToolCalls(toolCalls);
    const filteredReplayBlocks = Array.isArray(replayBlocks)
      ? replayBlocks.filter((block) => !isPlainRecord(block) || (block.type !== 'thinking' && block.type !== 'redacted_thinking') || hasToolCalls)
      : undefined;
    const canUseReplayBlocks = Array.isArray(filteredReplayBlocks)
      && filteredReplayBlocks.length > 0
      && (hasToolCalls
        ? this.replayedAnthropicAssistantBlocksCoverToolCalls(filteredReplayBlocks, toolCalls)
        : true);

    const pushText = (value: unknown) => {
      const text = this.stringifyAnthropicContent(value);
      if (text.length > 0) {
        contentBlocks.push({ type: 'text', text });
      }
    };

    if (canUseReplayBlocks && Array.isArray(filteredReplayBlocks)) {
      for (const block of filteredReplayBlocks) {
        const normalizedBlock = this.normalizeAnthropicAssistantBlock(block);
        if (!normalizedBlock) {
          continue;
        }
        contentBlocks.push(normalizedBlock);
        if (normalizedBlock.type === 'tool_use' && typeof normalizedBlock.id === 'string') {
          seenToolUseIds.add(normalizedBlock.id);
        }
      }
    }

    if (contentBlocks.length === 0) {
      if (typeof message.content === 'string') {
        pushText(message.content);
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          const normalizedBlock = this.normalizeAnthropicAssistantBlock(block);
          if (!normalizedBlock) {
            continue;
          }
          contentBlocks.push(normalizedBlock);
          if (normalizedBlock.type === 'tool_use' && typeof normalizedBlock.id === 'string') {
            seenToolUseIds.add(normalizedBlock.id);
          }
        }
      } else if (message.content != null) {
        pushText(message.content);
      }
    }

    for (const toolCall of toolCalls) {
      const id = typeof toolCall?.id === 'string' ? toolCall.id.trim() : '';
      const name = typeof toolCall?.function?.name === 'string'
        ? toolCall.function.name.trim()
        : '';
      if (!id || !name || seenToolUseIds.has(id)) {
        continue;
      }

      const input = this.safeJsonParse(toolCall.function?.arguments);
      contentBlocks.push({
        type: 'tool_use',
        id,
        name,
        input: isPlainRecord(input) ? input : {},
      });
      seenToolUseIds.add(id);
    }

    return contentBlocks.filter(
      (block: any) => !(block.type === 'text' && typeof block.text === 'string' && block.text.length === 0),
    );
  }

  private normalizeAnthropicUserContent(content: unknown): string | any[] {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return this.stringifyAnthropicContent(content);
    }

    const blocks: any[] = [];

    const pushText = (value: unknown) => {
      const text = this.stringifyAnthropicContent(value);
      if (text.length > 0) {
        blocks.push({ type: 'text', text });
      }
    };

    for (const block of content) {
      if (typeof block === 'string') {
        pushText(block);
        continue;
      }

      if (!isPlainRecord(block)) {
        continue;
      }

      if (block.type === 'text' || block.type === 'input_text') {
        pushText(block.text);
        continue;
      }

      if (block.type === 'tool_result') {
        const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id.trim() : '';
        if (!toolUseId) {
          continue;
        }

        const normalizedBlock: Record<string, any> = {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: this.stringifyAnthropicContent(block.content),
        };
        if (block.is_error === true) {
          normalizedBlock.is_error = true;
        }
        blocks.push(normalizedBlock);
        continue;
      }

      if (block.type === 'image') {
        blocks.push(block);
        continue;
      }

      if (block.type === 'image_url' || block.type === 'input_image') {
        const parsed = this.parseAnthropicImageDataUrl(block.image_url);
        if (!parsed) {
          continue;
        }

        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: parsed.mediaType,
            data: parsed.data,
          },
        });
      }
    }

    const orderedBlocks = this.orderAnthropicUserBlocks(blocks);

    if (orderedBlocks.length === 0) {
      return '';
    }

    return orderedBlocks.length === 1 && orderedBlocks[0]?.type === 'text'
      ? orderedBlocks[0].text
      : orderedBlocks;
  }

  private messageContainsAnthropicToolUse(message: ChatCompletionMessage): boolean {
    if (message.role !== 'assistant') {
      return false;
    }

    if (Array.isArray((message as any).tool_calls) && (message as any).tool_calls.length > 0) {
      return true;
    }

    if (!Array.isArray(message.content)) {
      return false;
    }

    return message.content.some(
      (block) => isPlainRecord(block) && block.type === 'tool_use',
    );
  }

  private isAnthropicToolLoopInProgress(messages: ChatCompletionMessage[]): boolean {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role === 'system') {
        continue;
      }
      if (message.role === 'user') {
        return false;
      }
      if (message.role === 'tool') {
        return true;
      }
      if (this.messageContainsAnthropicToolUse(message)) {
        return true;
      }
      if (message.role === 'assistant') {
        return false;
      }
    }

    return false;
  }

  private getAnthropicToolLoopAssistantBlocks(messages: ChatCompletionMessage[]): any[] | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === 'system' || message.role === 'tool') {
        continue;
      }
      if (message.role === 'user') {
        return undefined;
      }
      if (message.role === 'assistant') {
        const blocks = this.normalizeAnthropicAssistantBlocks(message);
        return blocks.some((block: any) => block?.type === 'tool_use')
          ? blocks
          : undefined;
      }
    }

    return undefined;
  }

  private isAnthropicReplayableThinkingBlock(block: unknown): boolean {
    if (!isPlainRecord(block)) {
      return false;
    }

    if (block.type === 'thinking') {
      return typeof block.signature === 'string' && block.signature.length > 0;
    }

    return block.type === 'redacted_thinking'
      && typeof block.data === 'string'
      && block.data.length > 0;
  }

  private canContinueAnthropicThinking(messages: ChatCompletionMessage[]): boolean {
    const assistantBlocks = this.getAnthropicToolLoopAssistantBlocks(messages);
    if (!assistantBlocks || assistantBlocks.length === 0) {
      return false;
    }

    return assistantBlocks.some((block: any) => this.isAnthropicReplayableThinkingBlock(block));
  }

  private ensureAnthropicThinkingDisplay(thinking: Record<string, unknown>): Record<string, unknown> {
    const type = typeof thinking.type === 'string' ? thinking.type : '';
    if (!type || type === 'disabled' || typeof thinking.display === 'string') {
      return thinking;
    }

    return {
      ...thinking,
      display: 'summarized',
    };
  }

  private extractAnthropicReasoningText(assistantBlocks: any[]): string | undefined {
    const reasoningParts = assistantBlocks
      .map((block) => (
        isPlainRecord(block)
        && block.type === 'thinking'
        && typeof block.thinking === 'string'
        && block.thinking.trim().length > 0
          ? block.thinking
          : ''
      ))
      .filter((part) => part.length > 0);

    return reasoningParts.length > 0 ? reasoningParts.join('\n\n') : undefined;
  }

  private clampAnthropicThinkingConfig(
    thinking: Record<string, unknown>,
    maxTokens: number,
  ): Record<string, unknown> | undefined {
    const type = typeof thinking.type === 'string' ? thinking.type : '';
    if (!type || type === 'disabled') {
      return undefined;
    }

    if (type !== 'enabled') {
      return thinking;
    }

    const rawBudget = typeof thinking.budget_tokens === 'number'
      ? Math.floor(thinking.budget_tokens)
      : NaN;
    if (!Number.isFinite(rawBudget) || rawBudget <= 0) {
      return thinking;
    }

    if (maxTokens <= 1024) {
      return undefined;
    }

    if (rawBudget < maxTokens) {
      return thinking;
    }

    return {
      ...thinking,
      budget_tokens: Math.max(1024, maxTokens - 1),
    };
  }

  private normalizeAnthropicOutputConfig(
    outputConfig: unknown,
  ): AnthropicOutputConfig | undefined {
    if (!isPlainRecord(outputConfig)) {
      return undefined;
    }

    const normalized: AnthropicOutputConfig = { ...outputConfig };
    const effort = typeof normalized.effort === 'string'
      ? normalized.effort.toLowerCase()
      : '';

    if (effort) {
      if (/^(low|medium|high|max)$/.test(effort)) {
        normalized.effort = effort as AnthropicEffort;
      } else {
        delete normalized.effort;
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  private isDirectAnthropicTemperatureRestrictedModel(model: string | undefined): boolean {
    const lower = (model || '').toLowerCase();

    return /claude-(?:opus|sonnet)-4-[6-9](?:$|[^0-9])/.test(lower)
      || /claude-(?:opus|sonnet)-[5-9](?:$|[^0-9])/.test(lower);
  }

  private normalizeAnthropicTemperature(
    model: string | undefined,
    temperature: number | undefined,
  ): number | undefined {
    if (!Number.isFinite(temperature)) {
      return undefined;
    }

    if (!this.isDirectAnthropicTemperatureRestrictedModel(model)) {
      return temperature;
    }

    return Math.abs((temperature as number) - 1) < Number.EPSILON ? 1 : undefined;
  }

  private sanitizeAnthropicRequestOptions(
    model: string | undefined,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ): { thinking?: Record<string, unknown>; outputConfig?: AnthropicOutputConfig; temperature?: number } {
    const normalizedTemperature = this.normalizeAnthropicTemperature(model, options.temperature);
    const requestedThinking = isPlainRecord(options.thinking)
      ? { ...options.thinking }
      : undefined;
    const requestedOutputConfig = this.buildAnthropicOutputConfig(options);
    const formatOnlyOutputConfig: AnthropicOutputConfig | undefined = isPlainRecord(requestedOutputConfig?.format)
      ? { format: requestedOutputConfig.format }
      : undefined;
    if (!requestedThinking) {
      return {
        temperature: normalizedTemperature,
        ...(formatOnlyOutputConfig ? { outputConfig: formatOnlyOutputConfig } : {}),
      };
    }

    const thinking = this.clampAnthropicThinkingConfig(
      requestedThinking,
      options.maxTokens || 4096,
    );
    if (!thinking) {
      return {
        temperature: normalizedTemperature,
        ...(formatOnlyOutputConfig ? { outputConfig: formatOnlyOutputConfig } : {}),
      };
    }
    const visibleThinking = this.ensureAnthropicThinkingDisplay(thinking);

    const toolLoopInProgress = this.isAnthropicToolLoopInProgress(messages);

    // Anthropic thinking is incompatible with forced tool use, and tool-result
    // follow-ups must replay the exact signed thinking blocks from the prior
    // assistant message to stay in the same thinking mode.
    if (this.isForcedToolChoice(options.toolChoice) || (toolLoopInProgress && !this.canContinueAnthropicThinking(messages))) {
      return {
        temperature: normalizedTemperature,
        ...(formatOnlyOutputConfig ? { outputConfig: formatOnlyOutputConfig } : {}),
      };
    }

    return {
      thinking: visibleThinking,
      ...(requestedOutputConfig ? { outputConfig: requestedOutputConfig } : {}),
      temperature: undefined,
    };
  }

  private parseSseEventBlock(block: string): string | null {
    const dataLines: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;

      let value = line.slice(5);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }

    if (dataLines.length === 0) {
      return null;
    }

    return dataLines.join('\n');
  }

  private async *iterateSseData(response: Response): AsyncGenerator<string> {
    const streamableResponse = response as Response & { body?: ReadableStream<Uint8Array> | null };
    const emitCompleteBlocks = function* (
      service: LlmService,
      source: string,
      flush: boolean,
    ): Generator<{ remaining: string; data: string }> {
      const pattern = /\r?\n\r?\n/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(source)) !== null) {
        const block = source.slice(lastIndex, match.index);
        lastIndex = match.index + match[0].length;
        const data = service.parseSseEventBlock(block);
        if (data !== null) {
          yield { remaining: '', data };
        }
      }

      const remaining = source.slice(lastIndex);
      if (flush && remaining.trim().length > 0) {
        const data = service.parseSseEventBlock(remaining);
        if (data !== null) {
          yield { remaining: '', data };
        }
        return;
      }

      yield { remaining, data: '' };
    };

    // Some native fetch implementations can surface a truthy body object before
    // exposing the standard ReadableStream reader methods. Fall back to buffered
    // SSE parsing in that case instead of crashing on an invalid getReader().
    const readableBody = streamableResponse.body as { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | null | undefined;
    if (readableBody && typeof readableBody.getReader === 'function') {
      const reader = readableBody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          let nextBuffer = buffer;
          for (const part of emitCompleteBlocks(this, buffer, false)) {
            nextBuffer = part.remaining;
            if (part.data) {
              yield part.data;
            }
          }
          buffer = nextBuffer;
        }

        buffer += decoder.decode();
        for (const part of emitCompleteBlocks(this, buffer, true)) {
          if (part.data) {
            yield part.data;
          }
        }
      } finally {
        reader.releaseLock();
      }

      return;
    }

    if (typeof response.text !== 'function') {
      throw new TypeError('Streaming response body is not readable via getReader() and response.text() is unavailable.');
    }

    const rawText = await response.text();
    for (const part of emitCompleteBlocks(this, rawText, true)) {
      if (part.data) {
        yield part.data;
      }
    }
  }

  async fetchModels(): Promise<ModelsWithCapabilities> {
    if (this.isOnDeviceProvider()) {
      const models = getSelectableLocalLlmModels(this.config).sort((a, b) => a.localeCompare(b));
      const capabilities = Object.fromEntries(
        models.map((model) => [model, this.config.modelCapabilities?.[model] || inferModelCapabilities(model)]),
      );
      return { models, capabilities };
    }

    const baseUrl = this.getBaseUrl();
    const headers = this.getHeaders();
    const capabilities: Record<string, ModelCapabilities> = {};

    // Anthropic doesn't have a /models list endpoint — return known models
    if (this.isAnthropicProvider()) {
      const models = [
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ];
      for (const model of models) {
        capabilities[model] = { vision: true, tools: true, fileInput: true };
      }
      return { models, capabilities };
    }

    const urls = this.getProviderTransport() === 'gemini'
      ? [`${baseUrl}/models`]
      : [
          `${baseUrl}/models`,
          `${baseUrl.replace(/\/v\d+$/i, '')}/v1/models`,
        ];

    for (const url of urls) {
      try {
        const response = await this.performFetch(url, { headers, signal: createTimeoutSignal(10000) });
        if (!response.ok) continue;

        const json = await response.json() as any;
        const data = Array.isArray(json) ? json : (json?.data ?? json?.models ?? []);

        const models = data
          .map((m: any) => {
            if (typeof m === 'string') {
              return m.replace(/^models\//, '');
            }

            const id = typeof m?.id === 'string'
              ? m.id
              : typeof m?.name === 'string'
                ? m.name
                : undefined;
            return typeof id === 'string' ? id.replace(/^models\//, '') : undefined;
          })
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
          .sort((a: string, b: string) => a.localeCompare(b));

        for (const model of models) {
          capabilities[model] = inferModelCapabilities(model);
        }

        return { models, capabilities };
      } catch {
        continue;
      }
    }

    return { models: [], capabilities };
  }

  private buildGeminiModelName(model: string): string {
    return model
      .replace(/^models\//i, '')
      .replace(/^publishers\/[^/]+\/models\//i, '')
      .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//i, '')
      .trim();
  }

  private buildGeminiGenerateContentUrl(
    baseUrl: string,
    model: string,
    methodName: string,
  ): string {
    const geminiModel = this.buildGeminiModelName(model);
    const modelPath = isVertexNativeGeminiBaseUrl(baseUrl)
      ? `publishers/google/models/${encodeURIComponent(geminiModel)}`
      : `models/${encodeURIComponent(geminiModel)}`;
    return `${baseUrl}/${modelPath}:${methodName}`;
  }

  private getLegacyGeminiThinkingConfig(
    model: string,
    effort: ReasoningEffort,
  ): Record<string, unknown> {
    const lower = model.toLowerCase();
    const isGemini3 = lower.includes('gemini-3');
    const isGeminiPro = lower.includes('pro');

    if (isGemini3) {
      const levelMap: Record<ReasoningEffort, string> = {
        none: isGeminiPro ? 'LOW' : 'MINIMAL',
        minimal: isGeminiPro ? 'LOW' : 'MINIMAL',
        low: 'LOW',
        medium: 'MEDIUM',
        high: 'HIGH',
        xhigh: 'HIGH',
      };
      return { thinkingLevel: levelMap[effort] };
    }

    if (isGeminiPro) {
      const budgetMap: Record<ReasoningEffort, number> = {
        none: 128,
        minimal: 512,
        low: 2048,
        medium: 8192,
        high: 16384,
        xhigh: 32768,
      };
      return { thinkingBudget: budgetMap[effort] };
    }

    const budgetMap: Record<ReasoningEffort, number> = {
      none: 0,
      minimal: 256,
      low: 1024,
      medium: 4096,
      high: 16384,
      xhigh: 24576,
    };
    return { thinkingBudget: budgetMap[effort] };
  }

  private normalizeGeminiThinkingConfig(
    model: string,
    options: MessageRequestOptions,
  ): Record<string, unknown> | undefined {
    const requestedThinking = isPlainRecord(options.thinking)
      ? { ...options.thinking }
      : undefined;

    if (requestedThinking) {
      const normalized: Record<string, unknown> = {};
      const includeThoughts = typeof requestedThinking.includeThoughts === 'boolean'
        ? requestedThinking.includeThoughts
        : typeof requestedThinking.include_thoughts === 'boolean'
          ? requestedThinking.include_thoughts
          : undefined;
      const thinkingLevel = typeof requestedThinking.thinkingLevel === 'string'
        ? requestedThinking.thinkingLevel
        : typeof requestedThinking.thinking_level === 'string'
          ? requestedThinking.thinking_level
          : undefined;
      const thinkingBudget = typeof requestedThinking.thinkingBudget === 'number'
        ? requestedThinking.thinkingBudget
        : typeof requestedThinking.thinking_budget === 'number'
          ? requestedThinking.thinking_budget
          : undefined;

      if (includeThoughts !== undefined) {
        normalized.includeThoughts = includeThoughts;
      }
      if (thinkingLevel) {
        normalized.thinkingLevel = thinkingLevel.toUpperCase();
      }
      if (Number.isFinite(thinkingBudget)) {
        normalized.thinkingBudget = Math.floor(thinkingBudget as number);
      }

      if (Object.keys(normalized).length > 0 && includeThoughts === undefined) {
        normalized.includeThoughts = true;
      }

      return Object.keys(normalized).length > 0 ? normalized : undefined;
    }

    if (!options.reasoning_effort) {
      return undefined;
    }

    return {
      ...this.getLegacyGeminiThinkingConfig(model, options.reasoning_effort),
      includeThoughts: true,
    };
  }

  private parseGeminiInlineDataUrl(value: unknown): { mimeType: string; data: string } | null {
    const url = typeof value === 'string'
      ? value
      : isPlainRecord(value) && typeof value.url === 'string'
        ? value.url
        : '';

    if (!url) {
      return null;
    }

    const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (!match) {
      return null;
    }

    return {
      mimeType: match[1].trim(),
      data: match[2].replace(/\s+/g, ''),
    };
  }

  private normalizeGeminiContentParts(content: unknown): any[] {
    if (typeof content === 'string') {
      return content.length > 0 ? [{ text: content }] : [];
    }

    if (!Array.isArray(content)) {
      if (content == null) {
        return [];
      }
      return [{ text: this.stringifyAnthropicContent(content) }];
    }

    const parts: any[] = [];

    for (const block of content) {
      if (typeof block === 'string') {
        if (block.length > 0) {
          parts.push({ text: block });
        }
        continue;
      }

      if (!isPlainRecord(block)) {
        continue;
      }

      const thoughtSignature = typeof block.thoughtSignature === 'string'
        ? block.thoughtSignature
        : typeof block.thought_signature === 'string'
          ? block.thought_signature
          : undefined;
      const isThoughtText = block.thought === true
        || /^(?:reasoning(?:_summary)?_text|reasoning|thinking|thought)$/.test(
          typeof block.type === 'string' ? block.type : '',
        );

      const functionCall = isPlainRecord(block.functionCall)
        ? block.functionCall
        : isPlainRecord(block.function_call)
          ? block.function_call
          : undefined;
      if (functionCall) {
        const normalizedPart: Record<string, any> = {
          functionCall: {
            name: typeof functionCall.name === 'string' ? functionCall.name : '',
            args: isPlainRecord(functionCall.args) ? functionCall.args : this.safeJsonParse(functionCall.args),
          },
        };
        if (thoughtSignature) {
          normalizedPart.thoughtSignature = thoughtSignature;
        }
        parts.push(normalizedPart);
        continue;
      }

      const functionResponse = isPlainRecord(block.functionResponse)
        ? block.functionResponse
        : isPlainRecord(block.function_response)
          ? block.function_response
          : undefined;
      if (functionResponse) {
        parts.push({
          functionResponse: {
            name: typeof functionResponse.name === 'string' ? functionResponse.name : '',
            response: isPlainRecord(functionResponse.response)
              ? functionResponse.response
              : { result: functionResponse.response },
          },
        });
        continue;
      }

      const inlineData = isPlainRecord(block.inlineData)
        ? block.inlineData
        : isPlainRecord(block.inline_data)
          ? block.inline_data
          : undefined;
      if (inlineData && typeof inlineData.data === 'string' && typeof inlineData.mimeType === 'string') {
        parts.push({ inlineData: { mimeType: inlineData.mimeType, data: inlineData.data } });
        continue;
      }

      if (block.type === 'text' || block.type === 'input_text') {
        if (typeof block.text === 'string' && block.text.length > 0) {
          const normalizedPart: Record<string, any> = { text: block.text };
          if (isThoughtText) {
            normalizedPart.thought = true;
          }
          if (thoughtSignature) {
            normalizedPart.thoughtSignature = thoughtSignature;
          }
          parts.push(normalizedPart);
        }
        continue;
      }

      if (block.type === 'image_url' || block.type === 'input_image') {
        const parsed = this.parseGeminiInlineDataUrl(block.image_url);
        if (parsed) {
          parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
        }
        continue;
      }

      if (block.type === 'input_file' || block.type === 'file') {
        const parsed = this.parseGeminiInlineDataUrl(block.file_data || block.fileData);
        if (parsed) {
          parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
        }
        continue;
      }

      if (typeof block.text === 'string' && block.text.length > 0) {
        const normalizedPart: Record<string, any> = { text: block.text };
        if (isThoughtText) {
          normalizedPart.thought = true;
        }
        if (thoughtSignature) {
          normalizedPart.thoughtSignature = thoughtSignature;
        }
        parts.push(normalizedPart);
      }
    }

    return parts;
  }

  private buildGeminiFunctionCallPart(toolCall: unknown): Record<string, any> | null {
    const sanitized = sanitizeGeminiToolCall(toolCall);
    if (!sanitized) {
      return null;
    }

    const parsedArgs = this.safeJsonParse(sanitized.function?.arguments);
    const thoughtSignature = extractGeminiToolCallThoughtSignature(sanitized);

    const part: Record<string, any> = {
      functionCall: {
        name: sanitized.function?.name || '',
        args: isPlainRecord(parsedArgs) ? parsedArgs : {},
      },
    };

    if (thoughtSignature) {
      part.thoughtSignature = thoughtSignature;
    }

    return part;
  }

  private shouldValidateGeminiCurrentTurnFunctionCalls(model: string): boolean {
    return model.toLowerCase().includes('gemini-3');
  }

  private ensureGeminiCurrentTurnFunctionCallSignature(parts: any[]): void {
    const firstFunctionCallPart = parts.find((part) => isPlainRecord(part) && isPlainRecord(part.functionCall));
    if (!firstFunctionCallPart) {
      return;
    }

    if (extractGeminiThoughtSignature(firstFunctionCallPart)) {
      return;
    }

    firstFunctionCallPart.thoughtSignature = GEMINI_DUMMY_THOUGHT_SIGNATURE;
  }

  private buildGeminiLegacyToolTurnParts(
    message: ChatCompletionMessage,
    toolCalls: unknown[],
  ): any[] {
    const parts = this.normalizeGeminiContentParts(message.content)
      .filter((part) => !part.functionCall && !part.functionResponse);
    const summarizedToolCalls = toolCalls
      .map((toolCall) => {
        const sanitized = sanitizeGeminiToolCall(toolCall);
        if (!sanitized) {
          return undefined;
        }

        const parsedArgs = this.safeJsonParse(sanitized.function?.arguments);
        const args = isPlainRecord(parsedArgs) || Array.isArray(parsedArgs)
          ? JSON.stringify(parsedArgs)
          : sanitized.function?.arguments || '{}';
        return `- ${sanitized.function?.name || 'tool'} ${args}`;
      })
      .filter((entry): entry is string => Boolean(entry));

    if (summarizedToolCalls.length > 0) {
      parts.push({
        text: [
          'Tool invocation history (exact Gemini replay metadata unavailable):',
          ...summarizedToolCalls,
        ].join('\n'),
      });
    }

    if (parts.length === 0) {
      parts.push({ text: 'Tool invocation history was retained as plain text because exact Gemini replay metadata was unavailable.' });
    }

    return parts;
  }

  private buildGeminiLegacyFunctionResponseTextPart(
    message: ChatCompletionMessage,
    toolNameById: Map<string, string>,
  ): Record<string, any> | null {
    const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
    if (!toolCallId) {
      return null;
    }

    const toolName = normalizeGeminiToolName(message.name) || toolNameById.get(toolCallId) || 'tool';
    const resultText = extractGeminiHistoryText(message.content).trim() || 'No output.';
    const prefix = message.is_error === true ? 'Tool error' : 'Tool result';
    return {
      text: `${prefix} from ${toolName}:\n${resultText}`,
    };
  }

  private canReplayGeminiLegacyToolTurn(
    message: ChatCompletionMessage,
    toolCalls: unknown[],
    allowUnsignedCurrentTurn = false,
  ): boolean {
    if (toolCalls.length === 0) {
      return false;
    }

    const visibleParts = this.normalizeGeminiContentParts(message.content)
      .filter((part) => !part.functionCall && !part.functionResponse);
    if (visibleParts.length > 0) {
      return false;
    }

    return allowUnsignedCurrentTurn || typeof extractGeminiToolCallThoughtSignature(toolCalls[0]) === 'string';
  }

  private buildGeminiFunctionResponsePart(
    message: ChatCompletionMessage,
    toolNameById: Map<string, string>,
  ): Record<string, any> | null {
    const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
    if (!toolCallId) {
      return null;
    }

    const name = normalizeGeminiToolName(message.name) || toolNameById.get(toolCallId) || 'tool';
    const parsedContent = typeof message.content === 'string'
      ? parseGeminiJsonLikeText(message.content)
      : message.content;
    let responsePayload: Record<string, any>;

    if (isPlainRecord(parsedContent)) {
      responsePayload = message.is_error === true && !Object.prototype.hasOwnProperty.call(parsedContent, 'error')
        ? { error: parsedContent }
        : parsedContent;
    } else if (message.is_error === true) {
      responsePayload = { error: parsedContent ?? 'Tool failed.' };
    } else {
      responsePayload = { result: parsedContent ?? 'No output.' };
    }

    return {
      functionResponse: {
        name,
        response: responsePayload,
      },
    };
  }

  private buildGeminiConversation(
    model: string,
    messages: ChatCompletionMessage[],
  ): { systemInstruction?: { parts: Array<{ text: string }> }; contents: Array<{ role: 'user' | 'model'; parts: any[] }> } {
    const systemInstructions: string[] = [];
    const contents: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
    const toolNameById = new Map<string, string>();
    const legacyToolNameById = new Map<string, string>();
    let pendingFunctionResponses: any[] = [];
    let pendingLegacyToolTexts: any[] = [];
    const validateCurrentTurnFunctionCalls = this.shouldValidateGeminiCurrentTurnFunctionCalls(model);
    const currentTurnStartIndex = (() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const candidate = messages[index];
        if (candidate.role !== 'user') {
          continue;
        }

        const hasStandardContent = this.normalizeGeminiContentParts(candidate.content)
          .some((part) => !part.functionResponse);
        if (hasStandardContent) {
          return index;
        }
      }

      return -1;
    })();

    const flushPendingFunctionResponses = () => {
      if (pendingFunctionResponses.length === 0) {
        return;
      }
      contents.push({ role: 'user', parts: pendingFunctionResponses });
      pendingFunctionResponses = [];
    };

    const flushPendingLegacyToolTexts = () => {
      if (pendingLegacyToolTexts.length === 0) {
        return;
      }
      contents.push({ role: 'user', parts: pendingLegacyToolTexts });
      pendingLegacyToolTexts = [];
    };

    const flushPendingToolHistory = () => {
      flushPendingFunctionResponses();
      flushPendingLegacyToolTexts();
    };

    for (const [messageIndex, message] of messages.entries()) {
      if (message.role === 'system') {
        const text = extractGeminiHistoryText(message.content).trim();
        if (text.length > 0) {
          systemInstructions.push(text);
        }
        continue;
      }

      if (message.role === 'tool') {
        const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
        const part = toolCallId && legacyToolNameById.has(toolCallId)
          ? this.buildGeminiLegacyFunctionResponseTextPart(message, legacyToolNameById)
          : this.buildGeminiFunctionResponsePart(message, toolNameById);
        if (part) {
          if (toolCallId && legacyToolNameById.has(toolCallId)) {
            pendingLegacyToolTexts.push(part);
          } else {
            pendingFunctionResponses.push(part);
          }
        }
        continue;
      }

      flushPendingToolHistory();

      if (message.role === 'assistant') {
        const replayParts = Array.isArray(message.providerReplay?.geminiParts)
          ? message.providerReplay.geminiParts.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
          : [];
        const toolCalls = Array.isArray((message as any).tool_calls)
          ? (message as any).tool_calls
          : [];
        for (const toolCall of toolCalls) {
          const sanitized = sanitizeGeminiToolCall(toolCall);
          if (!sanitized) {
            continue;
          }
          toolNameById.set(sanitized.id, sanitized.function?.name || 'tool');
        }
        const isCurrentTurnFunctionStep = validateCurrentTurnFunctionCalls
          && currentTurnStartIndex >= 0
          && messageIndex > currentTurnStartIndex;
        const canReplayLegacyToolTurn = replayParts.length === 0
          && this.canReplayGeminiLegacyToolTurn(message, toolCalls, isCurrentTurnFunctionStep);
        const parts = replayParts.length > 0
          ? this.normalizeGeminiContentParts(replayParts)
          : canReplayLegacyToolTurn
            ? []
            : toolCalls.length > 0
              ? this.buildGeminiLegacyToolTurnParts(message, toolCalls)
              : this.normalizeGeminiContentParts(message.content)
            .filter((part) => !part.functionCall && !part.functionResponse);

        if (replayParts.length === 0 && canReplayLegacyToolTurn) {
          for (const toolCall of toolCalls) {
            const part = this.buildGeminiFunctionCallPart(toolCall);
            if (!part) {
              continue;
            }
            parts.push(part);
          }
        } else if (replayParts.length === 0 && toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            const sanitized = sanitizeGeminiToolCall(toolCall);
            if (!sanitized) {
              continue;
            }
            legacyToolNameById.set(sanitized.id, sanitized.function?.name || 'tool');
          }
        }

        if (isCurrentTurnFunctionStep) {
          this.ensureGeminiCurrentTurnFunctionCallSignature(parts);
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        continue;
      }

      if (message.role === 'user') {
        const parts = this.normalizeGeminiContentParts(message.content);
        if (parts.length > 0) {
          contents.push({ role: 'user', parts });
        }
      }
    }

    flushPendingToolHistory();

    return {
      ...(systemInstructions.length > 0
        ? {
            systemInstruction: {
              parts: [{ text: systemInstructions.join('\n\n') }],
            },
          }
        : {}),
      contents,
    };
  }

  private buildGeminiRequestBody(
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ): Record<string, any> {
    const body: Record<string, any> = this.buildGeminiConversation(model, messages);
    const generationConfig: Record<string, any> = {};
    const structuredOutput = normalizeStructuredOutputOptions(options.structuredOutput);
    const canApplyStructuredOutput = structuredOutput
      && (!options.tools?.length || this.supportsGeminiStructuredOutputWithTools(model));
    const requestTools = options.tools?.length && options.enablePromptCaching
      ? reorderToolsForPromptCaching(options.tools)
      : options.tools;

    if (options.maxTokens) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }

    if (options.temperature !== undefined && this.supportsTemperature(model)) {
      generationConfig.temperature = options.temperature;
    }

    const thinkingConfig = this.normalizeGeminiThinkingConfig(model, options);
    if (thinkingConfig) {
      generationConfig.thinkingConfig = thinkingConfig;
    }

    if (canApplyStructuredOutput && structuredOutput) {
      generationConfig.responseMimeType = structuredOutput.mimeType;
      generationConfig.responseJsonSchema = cleanGeminiSchema(structuredOutput.schema);
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    if (requestTools?.length) {
      body.tools = [{
        functionDeclarations: requestTools.map((tool) => {
          const normalizedSchema = normalizeToolInputSchema(tool.input_schema);
          return {
            name: tool.name,
            description: simplifyGeminiToolDescription(tool.description),
            parameters: cleanGeminiSchema(normalizedSchema),
          };
        }),
      }];

      const functionCallingConfig = this.buildGeminiFunctionCallingConfig(options.toolChoice);
      if (functionCallingConfig) {
        body.toolConfig = {
          functionCallingConfig,
        };
      }
    }

    const explicitCachedContent = resolveGeminiCachedContentHandle(options.promptCacheKey);
    if (options.enablePromptCaching && explicitCachedContent) {
      body.cachedContent = explicitCachedContent;
    }

    return body;
  }

  private normalizeGeminiFinishReason(finishReason: unknown): string {
    const normalized = typeof finishReason === 'string' ? finishReason.toUpperCase() : '';

    switch (normalized) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
      case 'RECITATION':
      case 'IMAGE_SAFETY':
      case 'IMAGE_PROHIBITED_CONTENT':
      case 'IMAGE_RECITATION':
        return 'content_filter';
      default:
        return normalized ? normalized.toLowerCase() : 'stop';
    }
  }

  private normalizeGeminiUsageResult(usage: any): Record<string, any> | undefined {
    const normalizedUsage = normalizeUsage(usage);
    if (!normalizedUsage) {
      return undefined;
    }

    const result: Record<string, any> = {
      prompt_tokens: normalizedUsage.inputTokens,
      completion_tokens: normalizedUsage.outputTokens,
      total_tokens: normalizedUsage.totalTokens,
    };

    if (normalizedUsage.cacheReadTokens > 0) {
      result.cache_read_input_tokens = normalizedUsage.cacheReadTokens;
      result.prompt_tokens_details = {
        cached_tokens: normalizedUsage.cacheReadTokens,
        ...(normalizedUsage.cacheWriteTokens > 0
          ? { cache_write_tokens: normalizedUsage.cacheWriteTokens }
          : {}),
      };
    }

    if (normalizedUsage.cacheWriteTokens > 0) {
      result.cache_creation_input_tokens = normalizedUsage.cacheWriteTokens;
      if (!result.prompt_tokens_details) {
        result.prompt_tokens_details = { cache_write_tokens: normalizedUsage.cacheWriteTokens };
      }
    }

    return result;
  }

  private normalizeGeminiResponse(json: any): any {
    const candidate = Array.isArray(json?.candidates)
      ? json.candidates.find((entry: unknown) => isPlainRecord(entry))
      : undefined;

    if (!candidate) {
      const blockReason = typeof json?.promptFeedback?.blockReason === 'string'
        ? json.promptFeedback.blockReason
        : '';
      if (blockReason) {
        throw new Error(`Gemini prompt blocked: ${blockReason}`);
      }
      throw new Error('Gemini response returned no candidates');
    }

    const parts = Array.isArray(candidate.content?.parts)
      ? candidate.content.parts.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
      : [];
    const replayParts = this.normalizeGeminiContentParts(parts);
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    const toolCalls: Array<Record<string, any>> = [];

    for (const part of parts) {
      const functionCall = isPlainRecord(part.functionCall)
        ? part.functionCall
        : isPlainRecord(part.function_call)
          ? part.function_call
          : undefined;

      if (functionCall) {
        const args = isPlainRecord(functionCall.args) ? functionCall.args : this.safeJsonParse(functionCall.args);
        const argumentsText = JSON.stringify(isPlainRecord(args) ? args : {});
        const raw: Record<string, any> = {
          id: typeof functionCall.id === 'string' && functionCall.id.length > 0
            ? functionCall.id
            : `gemini-call-${toolCalls.length}`,
          type: 'function',
          function: {
            name: typeof functionCall.name === 'string' ? functionCall.name : '',
            arguments: argumentsText,
          },
        };

        const thoughtSignature = typeof part.thoughtSignature === 'string'
          ? part.thoughtSignature
          : typeof part.thought_signature === 'string'
            ? part.thought_signature
            : undefined;
        if (thoughtSignature) {
          raw.extra_content = { google: { thought_signature: thoughtSignature } };
        }

        toolCalls.push({
          id: raw.id,
          type: 'function',
          index: toolCalls.length,
          function: { ...raw.function },
          raw,
        });
        continue;
      }

      if (part.thought === true) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          reasoningParts.push(part.text);
        }
        continue;
      }

      if (typeof part.text === 'string' && part.text.length > 0) {
        contentParts.push(part.text);
      }
    }

    return {
      choices: [{
        message: {
          role: 'assistant',
          content: contentParts.join(''),
          ...(reasoningParts.length > 0 ? { reasoning: reasoningParts.join('') } : {}),
          ...(replayParts.length > 0 ? { providerReplay: { geminiParts: replayParts } } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0
          ? 'tool_calls'
          : this.normalizeGeminiFinishReason(candidate.finishReason),
      }],
      ...(this.normalizeGeminiUsageResult(json?.usageMetadata)
        ? { usage: this.normalizeGeminiUsageResult(json?.usageMetadata) }
        : {}),
    };
  }

  private async sendGeminiMessage(
    baseUrl: string,
    headers: Record<string, string>,
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ): Promise<any> {
    const geminiModel = this.buildGeminiModelName(model);
    const body = this.buildGeminiRequestBody(geminiModel, messages, options);
    let activeCachedContent = resolveGeminiCachedContentHandle(options.promptCacheKey);
    const { cacheableText, dynamicText } = splitCacheableSystemPromptSections(options.systemPromptSections);

    if (!activeCachedContent && options.enablePromptCaching && cacheableText) {
      const managedCachedContent = await ensureGeminiPromptCache({
        baseUrl,
        model: geminiModel,
        conversationId: options.conversationId,
        systemPrompt: cacheableText,
        headers,
        signal: options.signal,
        fetchImpl: (url, init) => this.performFetch(url, init, false),
      });

      if (managedCachedContent) {
        activeCachedContent = managedCachedContent;
        body.cachedContent = managedCachedContent;
      }
    }

    if (activeCachedContent && cacheableText) {
      if (dynamicText) {
        body.systemInstruction = {
          parts: [{ text: dynamicText }],
        };
      } else {
        delete body.systemInstruction;
      }
    }

    const methodName = options.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const requestHeaders = options.stream
      ? { ...headers, Accept: 'text/event-stream' }
      : headers;

    const response = await this.performFetch(this.buildGeminiGenerateContentUrl(baseUrl, model, methodName), {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.stream ?? false);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`LLM API error ${response.status}: ${errorText}`);
    }

    if (options.stream) {
      return response;
    }

    const json = await response.json();
    return this.attachProviderResponse(this.normalizeGeminiResponse(json), 'gemini', json);
  }

  private async sendCompatibleChatCompletionsMessage(
    baseUrl: string,
    headers: Record<string, string>,
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ): Promise<any> {
    const body: Record<string, any> = {
      model,
      messages,
      stream: options.stream ?? false,
    };
    const requestTools = options.tools?.length && options.enablePromptCaching
      ? reorderToolsForPromptCaching(options.tools)
      : options.tools;

    if (options.stream && this.isGeminiModel(model)) {
      body.stream_options = { include_usage: true };
    }

    if (options.maxTokens) {
      body.max_tokens = options.maxTokens;
    }
    if (options.temperature !== undefined && this.supportsTemperature(model)) {
      body.temperature = options.temperature;
    }
    if (options.reasoning_effort && this.isOpenAIReasoningModel(model)) {
      body.reasoning_effort = options.reasoning_effort;
    }
    const structuredOutput = normalizeStructuredOutputOptions(options.structuredOutput);
    if (structuredOutput) {
      body.response_format = this.buildCompatibleStructuredOutputFormat(structuredOutput);
    }
    if (requestTools?.length) {
      body.tools = requestTools.map((tool) => {
        const normalizedSchema = normalizeToolInputSchema(tool.input_schema);
        const useStrict = this.isOpenAIProvider() && tool.strict !== false && isStrictCompatibleSchema(normalizedSchema);

        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: useStrict ? strictifyOpenAiSchema(normalizedSchema) : normalizedSchema,
            ...(useStrict ? { strict: true } : {}),
          },
        };
      });
      const toolChoice = this.buildCompatibleToolChoice(options.toolChoice);
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
      if (this.shouldDisableParallelToolUse(options.toolChoice)) {
        body.parallel_tool_calls = false;
      }
    }

    if (this.isOpenAIProvider() && options.enablePromptCaching) {
      const promptCacheKey = normalizeOpenAIPromptCacheKey(options.promptCacheKey);
      if (promptCacheKey) {
        body.prompt_cache_key = promptCacheKey;
      }
      body.prompt_cache_retention = this.normalizeOpenAIPromptCacheRetention(options.promptCacheRetention);
    }

    const requestHeaders = options.stream
      ? { ...headers, Accept: 'text/event-stream' }
      : headers;

    const response = await this.performFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.stream ?? false);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`LLM API error ${response.status}: ${errorText}`);
    }

    if (options.stream) {
      return response;
    }

    return response.json();
  }

  async sendMessage(
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions = {},
  ): Promise<any> {
    if (this.isOnDeviceProvider()) {
      const localConfig = options.model && options.model !== this.config.model
        ? { ...this.config, model: options.model }
        : this.config;
      return sendLocalLlmMessage(localConfig, messages);
    }

    const baseUrl = this.getBaseUrl();
    const headers = this.getHeaders();
    const model = options.model || this.config.model;
    const providerTransport = this.getProviderTransport();

    switch (providerTransport) {
      case 'anthropic':
        return this.sendAnthropicMessage(baseUrl, headers, model, messages, options);
      case 'gemini':
        return this.sendGeminiMessage(baseUrl, headers, model, messages, options);
      case 'openai':
        return this.sendOpenAIResponsesMessage(baseUrl, headers, model, messages, options);
      default:
        return this.sendCompatibleChatCompletionsMessage(baseUrl, headers, model, messages, options);
    }
  }

  async generateImage(options: {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    style?: 'vivid' | 'natural';
    signal?: AbortSignal;
  }): Promise<GeneratedImagePayload> {
    if (this.isOnDeviceProvider()) {
      throw new Error('On-device local models do not support image generation in this build');
    }
    if (this.isAnthropicProvider()) {
      throw new Error('Anthropic image generation is not supported');
    }
    if (this.isGeminiProvider()) {
      return this.generateGeminiImage(options);
    }
    return this.generateOpenAICompatibleImage(options);
  }

  async editImage(options: {
    prompt: string;
    model?: string;
    images: ImageEditPayloadSource[];
    mask?: ImageEditPayloadSource;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    inputFidelity?: 'high' | 'low';
    moderation?: 'auto' | 'low';
    outputCompression?: number;
    signal?: AbortSignal;
  }): Promise<GeneratedImagePayload> {
    if (this.isOnDeviceProvider()) {
      throw new Error('On-device local models do not support image editing in this build');
    }
    if (this.isAnthropicProvider()) {
      throw new Error('Anthropic image editing is not supported');
    }
    if (this.isGeminiProvider()) {
      return this.editGeminiImage(options);
    }
    return this.editOpenAICompatibleImage(options);
  }

  private async generateOpenAICompatibleImage(options: {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    style?: 'vivid' | 'natural';
    signal?: AbortSignal;
  }): Promise<GeneratedImagePayload> {
    const baseUrl = this.getBaseUrl();
    const headers = this.getHeaders();
    const model = options.model || this.config.model || 'gpt-image-2';
    const body: Record<string, any> = {
      prompt: options.prompt,
      model,
      n: 1,
    };

    if (options.size) body.size = options.size;
    if (options.quality) body.quality = options.quality;
    if (options.style && /^dall-e-3$/i.test(model)) body.style = options.style;

    if (/^gpt-image/i.test(model)) {
      body.output_format = options.format || 'png';
      if (options.background) body.background = options.background;
    } else {
      body.response_format = 'b64_json';
    }

    const response = await this.performFetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Image generation error ${response.status}: ${errorText}`);
    }

    const json = await response.json() as any;
    const first = json?.data?.[0];
    if (!first) {
      throw new Error('Image generation returned no results');
    }

    return {
      model,
      b64_json: first.b64_json,
      url: first.url,
      revisedPrompt: first.revised_prompt,
      outputFormat: json.output_format || body.output_format || options.format || 'png',
      usage: this.normalizeGeneratedImageUsage(json?.usage, model),
    };
  }

  private async editOpenAICompatibleImage(options: {
    prompt: string;
    model?: string;
    images: ImageEditPayloadSource[];
    mask?: ImageEditPayloadSource;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    inputFidelity?: 'high' | 'low';
    moderation?: 'auto' | 'low';
    outputCompression?: number;
    signal?: AbortSignal;
  }): Promise<GeneratedImagePayload> {
    const baseUrl = this.getBaseUrl();
    const headers = this.getMultipartHeaders();
    const model = options.model || this.config.model || 'gpt-image-2';
    const isGptImageModel = /^gpt-image/i.test(model) || /^chatgpt-image-latest$/i.test(model);
    const formData = new FormData();

    formData.append('model', model);
    formData.append('prompt', options.prompt);
    formData.append('n', '1');
    if (options.size) formData.append('size', options.size);
    if (options.quality) formData.append('quality', options.quality);
    if (isGptImageModel) {
      if (options.format) formData.append('output_format', options.format);
      if (options.background) formData.append('background', options.background);
      if (options.inputFidelity) formData.append('input_fidelity', options.inputFidelity);
      if (options.moderation) formData.append('moderation', options.moderation);
      if (typeof options.outputCompression === 'number') {
        formData.append('output_compression', String(Math.round(options.outputCompression)));
      }
    } else {
      formData.append('response_format', 'b64_json');
    }

    const imageFieldName = options.images.length > 1 ? 'image[]' : 'image';
    for (const image of options.images) {
      this.appendMultipartImageSource(formData, imageFieldName, image);
    }
    if (options.mask) {
      this.appendMultipartImageSource(formData, 'mask', options.mask);
    }

    const response = await this.performFetch(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers,
      body: formData,
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Image edit error ${response.status}: ${errorText}`);
    }

    const json = await response.json() as any;
    const first = json?.data?.[0];
    if (!first) {
      throw new Error('Image editing returned no results');
    }

    return {
      model,
      b64_json: first.b64_json,
      url: first.url,
      revisedPrompt: first.revised_prompt,
      outputFormat: json.output_format || options.format || 'png',
      usage: this.normalizeGeneratedImageUsage(json?.usage, model),
    };
  }

  private async generateGeminiImage(options: {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    style?: 'vivid' | 'natural';
    signal?: AbortSignal;
  }): Promise<GeneratedImagePayload> {
    const apiKey = (this.config.apiKey || '').trim();
    if (!apiKey) {
      throw new Error('Gemini API key is required for image generation');
    }

    const model = options.model || this.config.model || 'gemini-3.1-flash-image-preview';
    const url = this.buildGeminiGenerateContentUrl(this.getGeminiBaseUrl(), model, 'generateContent');
    const headers = this.getHeaders();
    const response = await this.performFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(this.buildGeminiImageRequestBody(options)),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Gemini image generation error ${response.status}: ${this.extractGeminiApiErrorMessage(errorText)}`);
    }

    const json = await response.json() as any;
    return this.extractGeminiImagePayload(json, model);
  }

  private async editGeminiImage(options: {
    prompt: string;
    model?: string;
    images: ImageEditPayloadSource[];
    size?: string;
    signal?: AbortSignal;
  }): Promise<GeneratedImagePayload> {
    const apiKey = (this.config.apiKey || '').trim();
    if (!apiKey) {
      throw new Error('Gemini API key is required for image editing');
    }

    const model = options.model || this.config.model || 'gemini-3.1-flash-image-preview';
    const url = this.buildGeminiGenerateContentUrl(
      this.getGeminiBaseUrl(),
      model,
      'generateContent',
    );
    const headers = this.getHeaders();
    const response = await this.performFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(this.buildGeminiImageEditRequestBody(options)),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Gemini image editing error ${response.status}: ${this.extractGeminiApiErrorMessage(errorText)}`,
      );
    }

    const json = await response.json() as any;
    return this.extractGeminiImagePayload(json, model);
  }

  private buildGeminiImageRequestBody(options: {
    prompt: string;
    size?: string;
  }): Record<string, any> {
    return {
      contents: [{
        role: 'user',
        parts: [{ text: options.prompt }],
      }],
      generationConfig: this.buildGeminiImageGenerationConfig(options.size),
    };
  }

  private buildGeminiImageEditRequestBody(options: {
    prompt: string;
    images: ImageEditPayloadSource[];
    size?: string;
  }): Record<string, any> {
    const parts: any[] = options.images.map((source, index) => {
      const inlineData = this.parseGeminiInlineDataUrl(source.dataUri || source.uri);
      if (!inlineData) {
        throw new Error(
          `Gemini image editing requires inline image data for source ${index + 1}`,
        );
      }

      return {
        inlineData: {
          mimeType: inlineData.mimeType,
          data: inlineData.data,
        },
      };
    });

    parts.push({ text: options.prompt });

    return {
      contents: [{ role: 'user', parts }],
      generationConfig: this.buildGeminiImageGenerationConfig(options.size),
    };
  }

  private buildGeminiImageGenerationConfig(size?: string): Record<string, any> {
    const generationConfig: Record<string, any> = {
      responseModalities: ['IMAGE'],
    };
    const imageConfig: Record<string, any> = {};
    const aspectRatio = this.normalizeGeminiImageAspectRatio(size);
    const imageSize = this.normalizeGeminiImageOutputSize(size);

    if (aspectRatio) {
      imageConfig.aspectRatio = aspectRatio;
    }
    if (imageSize) {
      imageConfig.imageSize = imageSize;
    }
    if (Object.keys(imageConfig).length > 0) {
      generationConfig.imageConfig = imageConfig;
    }

    return generationConfig;
  }

  private getMultipartHeaders(): Record<string, string> {
    const headers = this.getHeaders();
    delete headers['Content-Type'];
    return headers;
  }

  private appendMultipartImageSource(
    formData: FormData,
    fieldName: string,
    source: ImageEditPayloadSource,
  ): void {
    formData.append(fieldName, {
      uri: source.uri,
      name: source.name || 'image.png',
      type: source.mimeType || 'image/png',
    } as any);
  }

  private normalizeGeneratedImageUsage(usage: unknown, model: string): TokenUsage | undefined {
    const normalizedUsage = normalizeUsage(usage);
    if (!normalizedUsage) {
      return undefined;
    }

    return {
      ...normalizedUsage,
      model,
    };
  }

  private normalizeGeminiImageAspectRatio(size?: string): string | undefined {
    const normalized = (size || '').trim();
    if (!normalized) {
      return undefined;
    }

    const upper = normalized.toUpperCase();
    if (GEMINI_IMAGE_SIZE_VALUES.has(upper as GeminiImageSizeValue)) {
      return undefined;
    }

    const ratioMatch = normalized.match(/^(\d+)\s*:\s*(\d+)$/);
    if (ratioMatch) {
      const width = Number.parseInt(ratioMatch[1], 10);
      const height = Number.parseInt(ratioMatch[2], 10);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined;
      }
      const divisor = greatestCommonDivisor(width, height);
      const ratio = `${width / divisor}:${height / divisor}`;
      return GEMINI_IMAGE_ASPECT_RATIOS.has(ratio) ? ratio : undefined;
    }

    const dimensionMatch = normalized.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!dimensionMatch) {
      return undefined;
    }

    const width = Number.parseInt(dimensionMatch[1], 10);
    const height = Number.parseInt(dimensionMatch[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined;
    }

    const divisor = greatestCommonDivisor(width, height);
    const ratio = `${width / divisor}:${height / divisor}`;
    return GEMINI_IMAGE_ASPECT_RATIOS.has(ratio) ? ratio : undefined;
  }

  private normalizeGeminiImageOutputSize(size?: string): GeminiImageSizeValue | undefined {
    const normalized = (size || '').trim().toUpperCase();
    if (!normalized) {
      return undefined;
    }

    if (GEMINI_IMAGE_SIZE_VALUES.has(normalized as GeminiImageSizeValue)) {
      return normalized as GeminiImageSizeValue;
    }

    const dimensionMatch = normalized.match(/^(\d+)\s*X\s*(\d+)$/);
    if (!dimensionMatch) {
      return undefined;
    }

    const width = Number.parseInt(dimensionMatch[1], 10);
    const height = Number.parseInt(dimensionMatch[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width !== height) {
      return undefined;
    }

    if (width === 512) return '512';
    if (width === 1024) return '1K';
    if (width === 2048) return '2K';
    if (width === 4096) return '4K';
    return undefined;
  }

  private extractGeminiApiErrorMessage(errorText: string): string {
    const parsed = this.safeJsonParse(errorText);
    if (isPlainRecord(parsed)) {
      const error = isPlainRecord(parsed.error) ? parsed.error : undefined;
      const message = typeof error?.message === 'string' ? error.message.trim() : '';
      const status = typeof error?.status === 'string' ? error.status.trim() : '';
      if (message && status) {
        return `${message} (${status})`;
      }
      if (message) {
        return message;
      }
      if (status) {
        return status;
      }
    }

    const trimmed = errorText.trim();
    return trimmed || 'Unknown Gemini API error';
  }

  private extractGeminiImagePayload(json: any, model: string): GeneratedImagePayload {
    const blockReason = typeof json?.promptFeedback?.blockReason === 'string'
      ? json.promptFeedback.blockReason.trim()
      : '';
    if (blockReason) {
      throw new Error(`Gemini image prompt blocked: ${blockReason}`);
    }

    const candidates = Array.isArray(json?.candidates)
      ? json.candidates.filter((candidate: unknown): candidate is Record<string, any> => isPlainRecord(candidate))
      : [];
    if (candidates.length === 0) {
      throw new Error('Gemini image generation returned no candidates');
    }

    let latestFinishReason = '';

    for (const candidate of candidates) {
      const finishReason = this.normalizeGeminiFinishReason(candidate.finishReason);
      if (finishReason && finishReason !== 'stop') {
        latestFinishReason = finishReason;
      }

      const parts = Array.isArray(candidate.content?.parts)
        ? candidate.content.parts.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
        : [];

      for (const part of parts) {
        const inline = isPlainRecord(part.inlineData)
          ? part.inlineData
          : isPlainRecord(part.inline_data)
            ? part.inline_data
            : undefined;
        const data = typeof inline?.data === 'string' ? inline.data.trim() : '';
        if (!data) {
          continue;
        }

        const mimeType = typeof inline?.mimeType === 'string'
          ? inline.mimeType
          : typeof inline?.mime_type === 'string'
            ? inline.mime_type
            : 'image/png';

        return {
          model,
          b64_json: data,
          outputFormat: mimeType.includes('jpeg') ? 'jpeg' : mimeType.includes('webp') ? 'webp' : 'png',
          usage: this.normalizeGeneratedImageUsage(json?.usageMetadata, model),
        };
      }
    }

    if (latestFinishReason === 'content_filter') {
      throw new Error('Gemini image generation was blocked by safety filters');
    }
    if (latestFinishReason) {
      throw new Error(`Gemini image generation returned no image data (finish reason: ${latestFinishReason})`);
    }

    throw new Error('Gemini image generation returned no image data');
  }

  private async sendAnthropicMessage(
    baseUrl: string,
    headers: Record<string, string>,
    model: string | undefined,
    messages: Array<{ role: string; content: string | any[]; tool_call_id?: string; name?: string }>,
    options: MessageRequestOptions,
  ): Promise<any> {
    // Extract system message and convert message format for Anthropic
    const anthropicOptions = this.sanitizeAnthropicRequestOptions(model, messages as ChatCompletionMessage[], options);
    let systemContent: string | undefined;
    const anthropicMessages: Array<{ role: string; content: string | any[] }> = [];
    let pendingToolResults: any[] = [];

    const flushPendingToolResults = () => {
      if (pendingToolResults.length === 0) {
        return;
      }

      // Anthropic requires alternating roles. If last message is also user,
      // merge tool results into it instead of creating a consecutive user message.
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg?.role === 'user') {
        lastMsg.content = this.mergeAnthropicContent(lastMsg.content, pendingToolResults);
      } else {
        anthropicMessages.push({
          role: 'user',
          content: pendingToolResults,
        });
      }
      pendingToolResults = [];
    };

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        continue;
      }

      if (msg.role === 'tool') {
        const toolContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const toolUseId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id.trim() : '';
        if (!toolUseId) {
          continue;
        }
        const isError = (msg as any).is_error === true || isToolResultErrorLike(toolContent);
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: toolContent,
          ...(isError ? { is_error: true } : {}),
        });
        continue;
      }

      flushPendingToolResults();

      if (msg.role === 'assistant') {
        const contentBlocks = this.normalizeAnthropicAssistantBlocks(msg);
        if (contentBlocks.length === 0) {
          continue;
        }

        const hasToolCalls = contentBlocks.some((block: any) => block.type === 'tool_use');
        const content: string | any[] = !hasToolCalls && contentBlocks.length === 1 && contentBlocks[0].type === 'text'
          ? contentBlocks[0].text
          : contentBlocks;

        // Anthropic requires alternating roles. Merge consecutive assistant messages.
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg?.role === 'assistant') {
          lastMsg.content = this.mergeAnthropicAssistantContent(lastMsg.content, content);
        } else {
          anthropicMessages.push({ role: 'assistant', content });
        }
        continue;
      }

      if (msg.role === 'user') {
        const normalizedContent = this.normalizeAnthropicUserContent(msg.content);
        if (this.anthropicContentIsEmpty(normalizedContent)) {
          continue;
        }

        // Anthropic requires alternating roles. Merge consecutive user messages.
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg?.role === 'user') {
          lastMsg.content = this.mergeAnthropicContent(lastMsg.content, normalizedContent);
        } else {
          anthropicMessages.push({ role: msg.role, content: normalizedContent });
        }
      }
    }

    flushPendingToolResults();
    const normalizedAnthropicMessages = this.normalizeAnthropicConversationHistory(anthropicMessages);

    const body: Record<string, any> = {
      model,
      messages: normalizedAnthropicMessages,
      max_tokens: options.maxTokens || 4096,
      stream: options.stream ?? false,
    };

    const anthropicSystemContent = buildAnthropicSystemPromptContent({
      systemContent,
      sections: options.systemPromptSections,
      enablePromptCaching: options.enablePromptCaching,
    });

    if (anthropicSystemContent) body.system = anthropicSystemContent;
    if (anthropicOptions.temperature !== undefined) body.temperature = anthropicOptions.temperature;
    if (anthropicOptions.thinking) body.thinking = anthropicOptions.thinking;
    if (anthropicOptions.outputConfig) body.output_config = anthropicOptions.outputConfig;
    if (options.enablePromptCaching) {
      body.cache_control = ANTHROPIC_EPHEMERAL_CACHE_CONTROL;
    }
    if (options.tools?.length) {
      const anthropicToolPlan = options.enablePromptCaching
        ? reorderAnthropicToolsForCaching(options.tools)
        : { orderedTools: options.tools, lastStablePrefixIndex: -1 };
      let strictBudget = MAX_ANTHROPIC_STRICT_TOOLS;
      body.tools = anthropicToolPlan.orderedTools.map((t, index) => {
        const normalizedSchema = normalizeToolInputSchema(t.input_schema);
        const useStrict = t.strict !== false && isStrictCompatibleSchema(normalizedSchema)
          && strictBudget > 0
          && isAnthropicStrictEligible(normalizedSchema);
        if (useStrict) strictBudget--;
        const base: Record<string, any> = {
          name: t.name,
          description: simplifyAnthropicToolDescription(t.description),
          input_schema: simplifyAnthropicSchema(
            useStrict ? strictifySchema(normalizedSchema) : normalizedSchema,
            { strict: useStrict },
          ),
        };
        if (options.enablePromptCaching && index === anthropicToolPlan.lastStablePrefixIndex) {
          base.cache_control = ANTHROPIC_EPHEMERAL_CACHE_CONTROL;
        }
        if (useStrict) base.strict = true;
        return base;
      });
      const toolChoice = this.buildAnthropicToolChoice(options.toolChoice);
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
    }

    const requestHeaders: Record<string, string> = options.stream
      ? { ...headers, Accept: 'text/event-stream' }
      : { ...headers };

    if (this.shouldIncludeAnthropicInterleavedThinkingBeta(model, options, anthropicOptions.thinking)) {
      requestHeaders['anthropic-beta'] = ANTHROPIC_INTERLEAVED_THINKING_BETA;
    }

    let response = await this.performFetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: options.signal,
    }, options.stream ?? false);

    // Anthropic returns 400 "schema too complex" when the aggregate tool
    // schemas exceed their internal grammar-compilation budget.  Retry once
    // with all strict flags stripped — that removes additionalProperties and
    // the constrained-decoding path, which is the main complexity driver.
    if (!response.ok && response.status === 400 && body.tools?.length) {
      const errorText = await response.text().catch(() => '');
      if (/schema.*too.*complex/i.test(errorText)) {
        body.tools = body.tools.map((t: Record<string, any>) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        }));
        response = await this.performFetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(body),
          signal: options.signal,
        }, options.stream ?? false);
      }

      if (!response.ok) {
        const retryErrorText = await response.text().catch(() => response.statusText);
        throw new Error(`LLM API error ${response.status}: ${retryErrorText}`);
      }
    } else if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`LLM API error ${response.status}: ${errorText}`);
    }

    if (options.stream) {
      return response;
    }

    // Convert Anthropic response to OpenAI format for compatibility
    const json = await response.json();
    const normalizedUsage = normalizeUsage(json.usage);
    const assistantBlocks = this.normalizeAnthropicAssistantBlocks({
      role: 'assistant',
      content: Array.isArray(json.content) ? json.content : [],
    });
    const reasoning = this.extractAnthropicReasoningText(assistantBlocks);
    const providerReplay: MessageProviderReplay | undefined = assistantBlocks.length > 0
      ? { anthropicBlocks: assistantBlocks }
      : undefined;

    const normalizedResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: json.content?.map((c: any) => c.type === 'text' ? c.text : '').join('') || '',
          ...(reasoning ? { reasoning } : {}),
          ...(providerReplay ? { providerReplay } : {}),
          tool_calls: json.content
            ?.filter((c: any) => c.type === 'tool_use')
            .map((c: any, i: number) => ({
              id: c.id,
              type: 'function',
              index: i,
              function: { name: c.name, arguments: JSON.stringify(c.input) },
              raw: this.buildAnthropicReplayToolRaw(
                c.id,
                c.name,
                JSON.stringify(c.input ?? {}),
                assistantBlocks,
              ),
            })),
        },
        finish_reason: json.stop_reason === 'end_turn' ? 'stop' : json.stop_reason === 'tool_use' ? 'tool_calls' : json.stop_reason,
      }],
      usage: {
        prompt_tokens: normalizedUsage?.inputTokens ?? 0,
        completion_tokens: normalizedUsage?.outputTokens ?? 0,
        total_tokens: normalizedUsage?.totalTokens ?? ((normalizedUsage?.inputTokens ?? 0) + (normalizedUsage?.outputTokens ?? 0)),
        cache_creation_input_tokens: normalizedUsage?.cacheWriteTokens ?? 0,
        cache_read_input_tokens: normalizedUsage?.cacheReadTokens ?? 0,
      },
    };

    return this.attachProviderResponse(normalizedResponse, 'anthropic', json);
  }

  private safeJsonParse(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value ?? {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }

  private buildAnthropicReplayToolRaw(
    id: string,
    name: string,
    argumentsText: string,
    assistantBlocks: any[],
  ): Record<string, any> {
    return {
      id,
      type: 'function',
      function: {
        name,
        arguments: argumentsText,
      },
      extra_content: {
        anthropic: {
          assistant_blocks: assistantBlocks,
        },
      },
    };
  }

  async *streamMessage(
    messages: ChatCompletionMessage[],
    options: Omit<MessageRequestOptions, 'stream'> = {},
  ): AsyncGenerator<StreamEvent> {
    const model = options.model || this.config.model;
    const providerTransport = this.getProviderTransport();

    if (providerTransport === 'local') {
      const localConfig = options.model && options.model !== this.config.model
        ? { ...this.config, model: options.model }
        : this.config;
      for await (const event of streamLocalLlmMessage(localConfig, messages)) {
        if (event.type === 'token' && event.content) {
          yield { type: 'token', content: event.content };
          continue;
        }

        if (event.type === 'done') {
          yield {
            type: 'done',
            completion: {
              completionStatus: 'complete',
            },
          };
        }
      }
      return;
    }

    const response = await this.sendMessage(messages, { ...options, stream: true });

    if (providerTransport === 'anthropic') {
      yield* this.streamAnthropicResponse(response);
      return;
    }

    if (providerTransport === 'gemini') {
      yield* this.streamGeminiResponse(response, model);
      return;
    }

    if (providerTransport === 'openai') {
      const shouldSurfaceReasoning = this.shouldSurfaceReasoning(model);
      let fullContent = '';
      let latestOpenAIResponseId = '';
      let latestUsage:
        | { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number }
        | undefined;
      let latestReasoningItems: Record<string, any>[] = [];
      let latestOpenAIOutput: Record<string, any>[] = [];
      let latestCompletion: AssistantCompletionMetadata | undefined;
      const toolCalls: Record<number, StreamedToolCall> = {};
      const emittedToolCallSignatures = new Map<number, string>();
      const textDeltaKeys = new Set<string>();
      const refusalDeltaKeys = new Set<string>();
      const emittedReasoningKeys = new Set<string>();

      const ensureToolCall = (outputIndex: number): StreamedToolCall => {
        if (!toolCalls[outputIndex]) {
          toolCalls[outputIndex] = {
            id: '',
            name: '',
            arguments: '',
            raw: {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' },
              _openai: { outputIndex },
            },
          };
        }
        return toolCalls[outputIndex];
      };

      const updateToolCall = (outputIndex: number, raw: Record<string, any>) => {
        toolCalls[outputIndex] = this.mergeOpenAIStreamToolCall(toolCalls[outputIndex], raw);
      };

      const applyReasoningItemsToToolCalls = (items: Record<string, any>[]) => {
        latestReasoningItems = items;
        for (const [indexText, toolCall] of Object.entries(toolCalls)) {
          const outputIndex = Number(indexText);
          const raw = this.buildOpenAIResponseToolRaw({
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          }, {
            outputIndex,
            reasoningItems: items,
          });
          updateToolCall(outputIndex, raw);
        }
      };

      const captureUsage = (usage: any) => {
        const normalizedUsage = normalizeUsage(usage);
        if (!normalizedUsage) {
          return;
        }
        latestUsage = {
          inputTokens: normalizedUsage.inputTokens,
          outputTokens: normalizedUsage.outputTokens,
          cacheReadTokens: normalizedUsage.cacheReadTokens,
          cacheWriteTokens: normalizedUsage.cacheWriteTokens,
          totalTokens: normalizedUsage.totalTokens,
        };
      };

      for await (const data of this.iterateSseData(response)) {
        if (data === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(data);

          switch (parsed.type) {
            case 'response.output_item.added': {
              if (parsed.item?.type === 'function_call') {
                const outputIndex = parsed.output_index ?? 0;
                updateToolCall(
                  outputIndex,
                  this.buildOpenAIResponseToolRaw(parsed.item, {
                    outputIndex,
                    reasoningItems: latestReasoningItems,
                  }),
                );
              }
              break;
            }
            case 'response.function_call_arguments.delta': {
              const outputIndex = parsed.output_index ?? 0;
              const existing = ensureToolCall(outputIndex);
              updateToolCall(outputIndex, {
                id: existing.id,
                type: 'function',
                function: {
                  name: existing.name,
                  arguments: mergeStreamedArgumentText(
                    existing.arguments,
                    typeof parsed.delta === 'string' ? parsed.delta : '',
                  ),
                },
                ...(isPlainRecord(existing.raw?._openai) ? { _openai: existing.raw?._openai } : {}),
              });
              break;
            }
            case 'response.function_call_arguments.done': {
              const outputIndex = parsed.output_index ?? 0;
              const existing = ensureToolCall(outputIndex);
              updateToolCall(outputIndex, {
                id: existing.id,
                type: 'function',
                function: {
                  name: typeof parsed.name === 'string' ? parsed.name : existing.name,
                  arguments: typeof parsed.arguments === 'string' ? parsed.arguments : existing.arguments,
                },
                ...(isPlainRecord(existing.raw?._openai) ? { _openai: existing.raw?._openai } : {}),
              });
              const queuedToolCall = getEmittableStreamedToolCall(toolCalls, emittedToolCallSignatures, outputIndex);
              if (queuedToolCall) {
                yield { type: 'tool_call', toolCall: queuedToolCall };
              }
              break;
            }
            case 'response.output_item.done': {
              if (parsed.item?.type === 'function_call') {
                const outputIndex = parsed.output_index ?? 0;
                updateToolCall(
                  outputIndex,
                  this.buildOpenAIResponseToolRaw(parsed.item, {
                    outputIndex,
                    reasoningItems: latestReasoningItems,
                  }),
                );
                const queuedToolCall = getEmittableStreamedToolCall(toolCalls, emittedToolCallSignatures, outputIndex);
                if (queuedToolCall) {
                  yield { type: 'tool_call', toolCall: queuedToolCall };
                }
              }
              break;
            }
            case 'response.output_text.delta': {
              const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
              textDeltaKeys.add(key);
              if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
                fullContent += parsed.delta;
                yield { type: 'token', content: parsed.delta };
              }
              break;
            }
            case 'response.output_text.done': {
              const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
              if (!textDeltaKeys.has(key) && typeof parsed.text === 'string' && parsed.text.length > 0) {
                fullContent += parsed.text;
                yield { type: 'token', content: parsed.text };
              }
              break;
            }
            case 'response.refusal.delta': {
              const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
              refusalDeltaKeys.add(key);
              if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
                fullContent += parsed.delta;
                yield { type: 'token', content: parsed.delta };
              }
              break;
            }
            case 'response.refusal.done': {
              const key = `${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`;
              if (!refusalDeltaKeys.has(key) && typeof parsed.refusal === 'string' && parsed.refusal.length > 0) {
                fullContent += parsed.refusal;
                yield { type: 'token', content: parsed.refusal };
              }
              break;
            }
            case 'response.reasoning_text.delta':
            case 'response.reasoning_summary_text.delta': {
              const key = parsed.type === 'response.reasoning_text.delta'
                ? `reasoning:${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`
                : `summary:${parsed.item_id ?? ''}:${parsed.summary_index ?? 0}`;
              if (shouldSurfaceReasoning && typeof parsed.delta === 'string' && parsed.delta.length > 0) {
                emittedReasoningKeys.add(key);
                yield { type: 'reasoning', content: parsed.delta };
              }
              break;
            }
            case 'response.reasoning_text.done':
            case 'response.reasoning_summary_text.done': {
              const key = parsed.type === 'response.reasoning_text.done'
                ? `reasoning:${parsed.item_id ?? ''}:${parsed.content_index ?? 0}`
                : `summary:${parsed.item_id ?? ''}:${parsed.summary_index ?? 0}`;
              if (!emittedReasoningKeys.has(key) && shouldSurfaceReasoning && typeof parsed.text === 'string' && parsed.text.length > 0) {
                emittedReasoningKeys.add(key);
                yield { type: 'reasoning', content: parsed.text };
              }
              break;
            }
            case 'response.completed':
            case 'response.incomplete': {
              latestCompletion = createCompletionMetadata(
                parsed.type === 'response.completed' ? 'complete' : 'incomplete',
                typeof parsed.response?.incomplete_details?.reason === 'string'
                  ? parsed.response.incomplete_details.reason
                  : typeof parsed.response?.status === 'string'
                    ? parsed.response.status
                    : parsed.type,
              );
              latestOpenAIResponseId = typeof parsed.response?.id === 'string' && parsed.response.id.trim().length > 0
                ? parsed.response.id.trim()
                : latestOpenAIResponseId;
              const output = Array.isArray(parsed.response?.output)
                ? parsed.response.output.filter((item: unknown): item is Record<string, any> => isPlainRecord(item))
                : [];
              latestOpenAIOutput = output;
              const reasoningItems = output.filter((item: Record<string, any>) => item.type === 'reasoning');
              if (reasoningItems.length > 0) {
                applyReasoningItemsToToolCalls(reasoningItems);
                if (shouldSurfaceReasoning) {
                  for (const item of reasoningItems) {
                    for (const part of this.getOpenAIReasoningTextParts(item)) {
                      if (emittedReasoningKeys.has(part.key) || part.text.length === 0) {
                        continue;
                      }
                      emittedReasoningKeys.add(part.key);
                      yield { type: 'reasoning', content: part.text };
                    }
                  }
                }
              }
              output.forEach((item: Record<string, any>, outputIndex: number) => {
                if (item.type !== 'function_call') {
                  return;
                }
                updateToolCall(
                  outputIndex,
                  this.buildOpenAIResponseToolRaw(item, {
                    outputIndex,
                    reasoningItems: reasoningItems.length > 0 ? reasoningItems : latestReasoningItems,
                  }),
                );
              });

              const normalized = this.normalizeOpenAIResponsesResult(parsed.response);
              const normalizedContent = normalized?.choices?.[0]?.message?.content;
              if (typeof normalizedContent === 'string' && normalizedContent.length > 0) {
                if (!fullContent || (normalizedContent.length > fullContent.length && normalizedContent.startsWith(fullContent))) {
                  fullContent = normalizedContent;
                }
              }
              captureUsage(parsed.response?.usage);
              break;
            }
            case 'response.failed': {
              const message = parsed.response?.error?.message || 'OpenAI response failed';
              throw new Error(message);
            }
            case 'error': {
              throw new Error(parsed.message || 'OpenAI streaming error');
            }
            default:
              break;
          }
        } catch (parseError) {
          if (parseError instanceof SyntaxError) {
            continue;
          }
          throw parseError;
        }
      }

      if (latestUsage) {
        yield { type: 'usage', usage: latestUsage };
      }
      for (const [indexText] of Object.entries(toolCalls)) {
        const queuedToolCall = getEmittableStreamedToolCall(
          toolCalls,
          emittedToolCallSignatures,
          Number(indexText),
        );
        if (queuedToolCall) {
          yield { type: 'tool_call', toolCall: queuedToolCall };
        }
      }
      yield {
        type: 'done',
        content: fullContent,
        ...((latestOpenAIOutput.length > 0 || latestOpenAIResponseId)
          ? {
            providerReplay: {
              ...(latestOpenAIResponseId ? { openaiResponseId: latestOpenAIResponseId } : {}),
              ...(latestOpenAIOutput.length > 0 ? { openaiResponseOutput: latestOpenAIOutput } : {}),
            },
          }
          : {}),
        completion: latestCompletion || createCompletionMetadata('incomplete', 'stream_ended_without_terminal_event'),
      };
      return;
    }

    let fullContent = '';
    const toolCalls: Record<number, StreamedToolCall> = {};
    const emittedToolCallSignatures = new Map<number, string>();
    const shouldSurfaceReasoning = this.shouldSurfaceReasoning(model);
    const geminiTarget = this.isGeminiProvider() || this.isGeminiModel(model);
    let latestCompletion: AssistantCompletionMetadata | undefined;

    // For Gemini-like providers on the compat path, build providerReplay so
    // buildGeminiConversation can replay exact tool-call parts, including any
    // real or documented dummy thought signatures.
    const geminiReplayParts: Record<string, any>[] = [];

    for await (const data of this.iterateSseData(response)) {
      if (data === '[DONE]') {
        for (const indexText of Object.keys(toolCalls)) {
          const queuedToolCall = getEmittableStreamedToolCall(
            toolCalls,
            emittedToolCallSignatures,
            Number(indexText),
          );
          if (queuedToolCall) {
            yield { type: 'tool_call', toolCall: queuedToolCall };
          }
        }
        // Prepend text content to Gemini replay parts if present
        if (geminiTarget && fullContent) {
          geminiReplayParts.unshift({ text: fullContent });
        }
        const providerReplay = geminiTarget && geminiReplayParts.length > 0
          ? { geminiParts: geminiReplayParts.filter(Boolean) }
          : undefined;
        yield {
          type: 'done',
          content: fullContent,
          ...(providerReplay ? { providerReplay } : {}),
          completion: latestCompletion || createCompletionMetadata('complete', 'done_marker'),
        };
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const normalizedUsage = normalizeUsage(parsed.usage);
        if (normalizedUsage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: normalizedUsage.inputTokens,
              outputTokens: normalizedUsage.outputTokens,
              cacheReadTokens: normalizedUsage.cacheReadTokens,
              cacheWriteTokens: normalizedUsage.cacheWriteTokens,
              totalTokens: normalizedUsage.totalTokens,
            },
          };
        }

        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        const extractedContent = extractOpenAiCompatibleStreamText(delta?.content);
        const visibleDelta = geminiTarget
          ? trimGeminiCumulativeText(fullContent, extractedContent.content)
          : extractedContent.content;
        if (visibleDelta) {
          fullContent += visibleDelta;
          yield { type: 'token', content: visibleDelta };
        }
        if (shouldSurfaceReasoning && extractedContent.reasoning) {
          yield { type: 'reasoning', content: extractedContent.reasoning };
        }

        const reasoningDelta = extractOpenAiCompatibleTextValue(delta?.reasoning_content);
        if (shouldSurfaceReasoning && reasoningDelta) {
          yield { type: 'reasoning', content: reasoningDelta };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
            }
            toolCalls[idx] = mergeStreamToolCallChunk(toolCalls[idx], tc);

            // Build Gemini replay parts from OpenAI-compat tool calls so
            // thought signatures survive through buildGeminiConversation.
            if (geminiTarget) {
              const merged = toolCalls[idx];
              const rawExtra = isPlainRecord(merged.raw?.extra_content?.google)
                ? merged.raw!.extra_content.google
                : undefined;
              const sig = typeof rawExtra?.thought_signature === 'string'
                ? rawExtra.thought_signature
                : undefined;
              const parsedArgs = this.safeJsonParse(merged.arguments);
              const replayPart: Record<string, any> = {
                functionCall: {
                  name: merged.name,
                  args: isPlainRecord(parsedArgs) ? parsedArgs : {},
                },
              };
              if (sig) {
                replayPart.thoughtSignature = sig;
              }
              // Replace or insert replay part for this index
              geminiReplayParts[idx] = replayPart;
            }
          }
        }
        if (choice.finish_reason === 'tool_calls') {
          for (const indexText of Object.keys(toolCalls)) {
            const queuedToolCall = getEmittableStreamedToolCall(
              toolCalls,
              emittedToolCallSignatures,
              Number(indexText),
            );
            if (queuedToolCall) {
              yield { type: 'tool_call', toolCall: queuedToolCall };
            }
          }
        }
        latestCompletion = normalizeOpenAiCompatibleCompletion(choice.finish_reason) || latestCompletion;
      } catch (parseError) {
        // Only skip actual JSON parse errors; re-throw everything else
        if (parseError instanceof SyntaxError) continue;
        throw parseError;
      }
    }

    // Final yield in case [DONE] was missing
    for (const indexText of Object.keys(toolCalls)) {
      const queuedToolCall = getEmittableStreamedToolCall(
        toolCalls,
        emittedToolCallSignatures,
        Number(indexText),
      );
      if (queuedToolCall) {
        yield { type: 'tool_call', toolCall: queuedToolCall };
      }
    }
    if (geminiTarget && fullContent) {
      geminiReplayParts.unshift({ text: fullContent });
    }
    const finalProviderReplay = geminiTarget && geminiReplayParts.length > 0
      ? { geminiParts: geminiReplayParts.filter(Boolean) }
      : undefined;
    if (fullContent || finalProviderReplay) {
      yield {
        type: 'done',
        content: fullContent,
        ...(finalProviderReplay ? { providerReplay: finalProviderReplay } : {}),
        completion: latestCompletion || createCompletionMetadata('incomplete', 'stream_ended_without_done_marker'),
      };
    }
  }

  private async *streamGeminiResponse(
    response: Response,
    model: string,
  ): AsyncGenerator<StreamEvent> {
    const shouldSurfaceReasoning = this.shouldSurfaceReasoning(model);
    const partBuffers = new Map<string, string>();
    const partSnapshots = new Map<string, { order: number; part: Record<string, any> }>();
    const toolCalls: Record<number, StreamedToolCall> = {};
    const emittedToolCallSignatures = new Map<number, string>();
    let fullContent = '';
    let latestGeminiParts: Record<string, any>[] = [];
    let latestCompletion: AssistantCompletionMetadata | undefined;
    let latestUsage:
      | { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number }
      | undefined;

    for await (const data of this.iterateSseData(response)) {
      if (data === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(data);
        const blockReason = typeof parsed?.promptFeedback?.blockReason === 'string'
          ? parsed.promptFeedback.blockReason
          : '';
        if (blockReason && !Array.isArray(parsed?.candidates)) {
          throw new Error(`Gemini prompt blocked: ${blockReason}`);
        }

        const candidate = Array.isArray(parsed?.candidates)
          ? parsed.candidates.find((entry: unknown) => isPlainRecord(entry))
          : undefined;
        if (candidate) {
          latestCompletion = normalizeGeminiCompletion(candidate.finishReason) || latestCompletion;
          const parts = Array.isArray(candidate.content?.parts)
            ? candidate.content.parts.filter((part: unknown): part is Record<string, any> => isPlainRecord(part))
            : [];

          for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
            const part = parts[partIndex];
            const functionCall = isPlainRecord(part.functionCall)
              ? part.functionCall
              : isPlainRecord(part.function_call)
                ? part.function_call
                : undefined;
            if (functionCall) {
              const id = typeof functionCall.id === 'string' && functionCall.id.length > 0
                ? functionCall.id
                : toolCalls[partIndex]?.id || `gemini-call-${partIndex}`;
              const name = typeof functionCall.name === 'string' && functionCall.name.length > 0
                ? functionCall.name
                : toolCalls[partIndex]?.name || '';
              const parsedArgs = isPlainRecord(functionCall.args)
                ? functionCall.args
                : this.safeJsonParse(functionCall.args);
              const argumentsText = JSON.stringify(isPlainRecord(parsedArgs) ? parsedArgs : {});
              const previousArguments = toolCalls[partIndex]?.arguments || '';
              const nextArguments = previousArguments && !argumentsText.startsWith(previousArguments)
                ? argumentsText
                : (argumentsText || previousArguments);
              const raw: Record<string, any> = {
                id,
                type: 'function',
                function: {
                  name,
                  arguments: nextArguments,
                },
              };

              const thoughtSignature = typeof part.thoughtSignature === 'string'
                ? part.thoughtSignature
                : typeof part.thought_signature === 'string'
                  ? part.thought_signature
                  : undefined;
              if (thoughtSignature) {
                raw.extra_content = {
                  google: {
                    thought_signature: thoughtSignature,
                  },
                };
              }

              const snapshotPart: Record<string, any> = {
                functionCall: {
                  name,
                  args: isPlainRecord(parsedArgs) ? parsedArgs : {},
                },
              };
              if (thoughtSignature) {
                snapshotPart.thoughtSignature = thoughtSignature;
              }
              partSnapshots.set(`${partIndex}:functionCall`, {
                order: partIndex * 10 + 2,
                part: snapshotPart,
              });
              latestGeminiParts = Array.from(partSnapshots.values())
                .sort((left, right) => left.order - right.order)
                .map((entry) => entry.part);

              toolCalls[partIndex] = {
                id,
                name,
                arguments: nextArguments,
                raw,
              };
              // Native Gemini can revise the same functionCall snapshot multiple
              // times before the stream ends. Emit the final settled snapshot in
              // the stream flush below so the UI does not oscillate between
              // provisional tool choices that are not executable yet.
              continue;
            }

            if (typeof part.text !== 'string' || part.text.length === 0) {
              continue;
            }

            const bufferKey = `${partIndex}:${part.thought === true ? 'thought' : 'text'}`;
            const previousText = partBuffers.get(bufferKey) || '';
            const nextFullText = part.text.startsWith(previousText)
              ? part.text
              : `${previousText}${part.text}`;
            const delta = nextFullText.slice(previousText.length);
            partBuffers.set(bufferKey, nextFullText);

            const snapshotPart: Record<string, any> = {
              text: nextFullText,
            };
            if (part.thought === true) {
              snapshotPart.thought = true;
            }
            const thoughtSignature = typeof part.thoughtSignature === 'string'
              ? part.thoughtSignature
              : typeof part.thought_signature === 'string'
                ? part.thought_signature
                : undefined;
            if (thoughtSignature) {
              snapshotPart.thoughtSignature = thoughtSignature;
            }
            partSnapshots.set(bufferKey, {
              order: partIndex * 10 + (part.thought === true ? 0 : 1),
              part: snapshotPart,
            });
            latestGeminiParts = Array.from(partSnapshots.values())
              .sort((left, right) => left.order - right.order)
              .map((entry) => entry.part);

            if (!delta) {
              continue;
            }

            if (part.thought === true) {
              if (shouldSurfaceReasoning) {
                yield { type: 'reasoning', content: delta };
              }
              continue;
            }

            fullContent += delta;
            yield { type: 'token', content: delta };
          }
        }

        const normalizedUsage = normalizeUsage(parsed?.usageMetadata);
        if (normalizedUsage) {
          latestUsage = {
            inputTokens: normalizedUsage.inputTokens,
            outputTokens: normalizedUsage.outputTokens,
            cacheReadTokens: normalizedUsage.cacheReadTokens,
            cacheWriteTokens: normalizedUsage.cacheWriteTokens,
            totalTokens: normalizedUsage.totalTokens,
          };
        }
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          continue;
        }
        throw parseError;
      }
    }

    if (latestUsage) {
      yield { type: 'usage', usage: latestUsage };
    }
    for (const indexText of Object.keys(toolCalls)) {
      const queuedToolCall = getEmittableStreamedToolCall(
        toolCalls,
        emittedToolCallSignatures,
        Number(indexText),
      );
      if (queuedToolCall) {
        yield { type: 'tool_call', toolCall: queuedToolCall };
      }
    }
    yield {
      type: 'done',
      content: fullContent,
      ...(latestGeminiParts.length > 0
        ? { providerReplay: { geminiParts: latestGeminiParts } }
        : {}),
      completion: latestCompletion || createCompletionMetadata('incomplete', 'stream_ended_without_finish_reason'),
    };
  }

  private async *streamAnthropicResponse(response: Response): AsyncGenerator<StreamEvent> {
    let fullContent = '';
    const toolCalls: Record<number, { id: string; name: string; arguments: string; raw?: Record<string, any>; receivedJsonDelta?: boolean }> = {};
    const emittedToolCallSignatures = new Map<number, string>();
    const contentBlocks = new Map<number, Record<string, any>>();
    let toolIndex = 0;
    let latestCompletion: AssistantCompletionMetadata | undefined;

    const finalizeAssistantBlocks = (): any[] => {
      const orderedBlocks = Array.from(contentBlocks.entries())
        .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
        .map(([index, block]) => {
          if (!isPlainRecord(block)) {
            return block;
          }

          if (block.type === 'tool_use') {
            const argumentsText = toolCalls[index]?.arguments || '';
            const parsedInput = this.safeJsonParse(argumentsText);
            return {
              type: 'tool_use',
              id: typeof block.id === 'string' ? block.id : '',
              name: typeof block.name === 'string' ? block.name : '',
              input: isPlainRecord(parsedInput) ? parsedInput : {},
            };
          }

          if (block.type === 'thinking') {
            return {
              type: 'thinking',
              thinking: typeof block.thinking === 'string' ? block.thinking : '',
              ...(typeof block.signature === 'string' && block.signature.length > 0
                ? { signature: block.signature }
                : {}),
            };
          }

          if (block.type === 'text') {
            return {
              type: 'text',
              text: typeof block.text === 'string' ? block.text : '',
            };
          }

          return { ...block };
        });

      return this.normalizeAnthropicAssistantBlocks({
        role: 'assistant',
        content: orderedBlocks,
      });
    };

    const extractAssistantText = (assistantBlocks: any[]): string => assistantBlocks
      .filter((block) => isPlainRecord(block) && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');

    const stringifyInitialToolInput = (value: unknown): string => {
      if (typeof value === 'string') {
        return value;
      }
      if (!isPlainRecord(value) || Object.keys(value).length === 0) {
        return '';
      }
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    };

    for await (const data of this.iterateSseData(response)) {
      try {
        const parsed = JSON.parse(data);

        switch (parsed.type) {
          case 'content_block_start': {
            const block = parsed.content_block;
            if (block?.type === 'tool_use') {
              toolCalls[parsed.index] = {
                id: block.id,
                name: block.name,
                arguments: stringifyInitialToolInput(block.input),
              };
              toolIndex = parsed.index;
            }
            if (isPlainRecord(block)) {
              if (block.type === 'thinking') {
                const initialThinking = typeof block.thinking === 'string' ? block.thinking : '';
                contentBlocks.set(parsed.index, {
                  type: 'thinking',
                  thinking: initialThinking,
                  signature: typeof block.signature === 'string' ? block.signature : '',
                });
                if (initialThinking.length > 0) {
                  yield { type: 'reasoning', content: initialThinking };
                }
              } else if (block.type === 'text') {
                const initialText = typeof block.text === 'string' ? block.text : '';
                contentBlocks.set(parsed.index, {
                  type: 'text',
                  text: initialText,
                });
                if (initialText.length > 0) {
                  fullContent += initialText;
                  yield { type: 'token', content: initialText };
                }
              } else if (block.type === 'tool_use') {
                contentBlocks.set(parsed.index, {
                  type: 'tool_use',
                  id: typeof block.id === 'string' ? block.id : '',
                  name: typeof block.name === 'string' ? block.name : '',
                });
              } else {
                contentBlocks.set(parsed.index, { ...block });
              }
            }
            break;
          }
          case 'content_block_delta': {
            const delta = parsed.delta;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              fullContent += delta.text;
              const textBlock = contentBlocks.get(parsed.index);
              if (textBlock?.type === 'text') {
                textBlock.text = `${typeof textBlock.text === 'string' ? textBlock.text : ''}${delta.text}`;
              }
              yield { type: 'token', content: delta.text };
            } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              const thinkingBlock = contentBlocks.get(parsed.index);
              if (thinkingBlock?.type === 'thinking') {
                thinkingBlock.thinking = `${typeof thinkingBlock.thinking === 'string' ? thinkingBlock.thinking : ''}${delta.thinking}`;
              }
              yield { type: 'reasoning', content: delta.thinking };
            } else if (delta?.type === 'signature_delta' && delta.signature) {
              const thinkingBlock = contentBlocks.get(parsed.index);
              if (thinkingBlock?.type === 'thinking') {
                thinkingBlock.signature = delta.signature;
              }
            } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const idx = parsed.index ?? toolIndex;
              if (toolCalls[idx]) {
                if (!toolCalls[idx].receivedJsonDelta) {
                  toolCalls[idx].arguments = '';
                  toolCalls[idx].receivedJsonDelta = true;
                }
                toolCalls[idx].arguments = mergeStreamedArgumentText(
                  toolCalls[idx].arguments,
                  delta.partial_json,
                );
              }
            }
            break;
          }
          case 'content_block_stop': {
            const idx = parsed.index ?? toolIndex;
            const contentBlock = contentBlocks.get(idx);
            if (contentBlock?.type === 'tool_use' && toolCalls[idx]) {
              const parsedInput = this.safeJsonParse(toolCalls[idx].arguments);
              contentBlock.input = isPlainRecord(parsedInput) ? parsedInput : {};
              toolCalls[idx].raw = this.buildAnthropicReplayToolRaw(
                toolCalls[idx].id,
                toolCalls[idx].name,
                toolCalls[idx].arguments,
                finalizeAssistantBlocks(),
              );
              const queuedToolCall = getEmittableStreamedToolCall(
                toolCalls as Record<number, StreamedToolCall>,
                emittedToolCallSignatures,
                idx,
              );
              if (queuedToolCall) {
                yield { type: 'tool_call', toolCall: queuedToolCall };
              }
            }
            break;
          }
          case 'message_delta': {
            latestCompletion = normalizeAnthropicCompletion(parsed.delta?.stop_reason) || latestCompletion;
            const normalizedUsage = normalizeUsage(parsed.usage);
            if (normalizedUsage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: normalizedUsage.inputTokens,
                  outputTokens: normalizedUsage.outputTokens,
                  cacheReadTokens: normalizedUsage.cacheReadTokens,
                  cacheWriteTokens: normalizedUsage.cacheWriteTokens,
                  totalTokens: normalizedUsage.totalTokens,
                },
              };
            }
            break;
          }
          case 'message_start': {
            const normalizedUsage = normalizeUsage(parsed.message?.usage);
            if (normalizedUsage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: normalizedUsage.inputTokens,
                  outputTokens: normalizedUsage.outputTokens,
                  cacheReadTokens: normalizedUsage.cacheReadTokens,
                  cacheWriteTokens: normalizedUsage.cacheWriteTokens,
                  totalTokens: normalizedUsage.totalTokens,
                },
              };
            }
            break;
          }
          case 'message_stop': {
            const assistantBlocks = finalizeAssistantBlocks();
            const finalContent = extractAssistantText(assistantBlocks) || fullContent;
            const finalProviderReplay: MessageProviderReplay | undefined = assistantBlocks.length > 0
              ? { anthropicBlocks: assistantBlocks }
              : undefined;
            for (const [indexText, tc] of Object.entries(toolCalls)) {
              toolCalls[Number(indexText)].raw = this.buildAnthropicReplayToolRaw(
                tc.id,
                tc.name,
                tc.arguments,
                assistantBlocks,
              );
              const queuedToolCall = getEmittableStreamedToolCall(
                toolCalls as Record<number, StreamedToolCall>,
                emittedToolCallSignatures,
                Number(indexText),
              );
              if (queuedToolCall) {
                yield {
                  type: 'tool_call',
                  toolCall: queuedToolCall,
                };
              }
            }
            yield {
              type: 'done',
              content: finalContent,
              ...(finalProviderReplay ? { providerReplay: finalProviderReplay } : {}),
              completion: latestCompletion || createCompletionMetadata('complete', 'message_stop'),
            };
            return;
          }
          case 'error': {
            const errorType = parsed.error?.type || '';
            const errorMsg = parsed.error?.message || 'Anthropic streaming error';
            throw new Error(`Anthropic ${errorType}: ${errorMsg}`);
          }
        }
      } catch (parseError) {
        // Only skip actual JSON parse errors; re-throw streaming/API errors
        if (parseError instanceof SyntaxError) continue;
        throw parseError;
      }
    }

    // Stream ended without message_stop — yield whatever we accumulated.
    // This can happen on network interruption or incomplete streams.
    const assistantBlocks = finalizeAssistantBlocks();
    const finalContent = extractAssistantText(assistantBlocks) || fullContent;
    const finalProviderReplay: MessageProviderReplay | undefined = assistantBlocks.length > 0
      ? { anthropicBlocks: assistantBlocks }
      : undefined;
    for (const [indexText, tc] of Object.entries(toolCalls)) {
      toolCalls[Number(indexText)].raw = this.buildAnthropicReplayToolRaw(
        tc.id,
        tc.name,
        tc.arguments,
        assistantBlocks,
      );
      const queuedToolCall = getEmittableStreamedToolCall(
        toolCalls as Record<number, StreamedToolCall>,
        emittedToolCallSignatures,
        Number(indexText),
      );
      if (queuedToolCall) {
        yield {
          type: 'tool_call',
          toolCall: queuedToolCall,
        };
      }
    }
    yield {
      type: 'done',
      content: finalContent,
      ...(finalProviderReplay ? { providerReplay: finalProviderReplay } : {}),
      completion: createCompletionMetadata('incomplete', 'stream_ended_without_message_stop'),
    };
  }
}
