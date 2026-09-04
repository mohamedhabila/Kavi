import type { LlmProviderConfig } from '../../../types/provider';
import { resolveProviderRouting } from './providerProtocols';
import { normalizeHostedModelId, resolveModelHostedFamily } from './providerFamilies';

const GEMINI_STRUCTURED_OUTPUT_WITH_TOOLS_PATTERNS = [
  /^gemini-3(?:\.1|-)/i,
  /^gemini-3\.5-/i,
  /^google\/gemini-3(?:\.1|-)/i,
  /^google\/gemini-3\.5-/i,
] as const;

export function isOpenAIReasoningModel(model: string): boolean {
  return /^(?:o1|o3|o4|gpt-5)/i.test(normalizeHostedModelId(model));
}

export function isGemini3Model(model: string | undefined): boolean {
  return (
    resolveModelHostedFamily(model) === 'gemini' &&
    /^gemini-3(?:[.-]|$)/i.test(normalizeHostedModelId(model))
  );
}

export function isGeminiProModel(model: string | undefined): boolean {
  return (
    resolveModelHostedFamily(model) === 'gemini' &&
    /^gemini(?:-[^/]+)*-pro(?:[.-]|$)/i.test(normalizeHostedModelId(model))
  );
}

// ---------------------------------------------------------------------------
// Anthropic model generation
// ---------------------------------------------------------------------------
//
// Anthropic model ids follow `claude-<family>-<major>[-<minor>]` (e.g.
// `claude-opus-5`, `claude-opus-4-7`, `claude-fable-5-1`). Request-shape rules
// (thinking mode, sampling params, forced tool_choice, supported effort levels)
// are governed by the family and generation encoded in that id, not by a fixed
// list of literal model names — so every rule below is derived by parsing the
// id structurally and comparing generations, which lets a new minor release
// (e.g. a future `claude-opus-4-9`) inherit the right behavior automatically
// instead of silently falling back to legacy request shapes.

export interface AnthropicModelGeneration {
  /** Structural family segment of the id, lowercased (e.g. 'opus', 'sonnet', 'fable'). */
  family: string;
  major: number;
  minor: number;
}

const ANTHROPIC_MODEL_ID_PATTERN = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:[-.]|$)/i;

/** Parses `model` into its Anthropic family/generation, or undefined if it isn't a recognizable Anthropic id. */
export function getAnthropicModelGeneration(
  model: string | undefined,
): AnthropicModelGeneration | undefined {
  if (resolveModelHostedFamily(model) !== 'anthropic') {
    return undefined;
  }

  const normalized = normalizeHostedModelId(model);
  const match = ANTHROPIC_MODEL_ID_PATTERN.exec(normalized);
  if (!match) {
    return undefined;
  }

  const [, family, majorText, minorText] = match;
  const major = Number.parseInt(majorText, 10);
  if (!Number.isFinite(major)) {
    return undefined;
  }
  const minor = minorText ? Number.parseInt(minorText, 10) : 0;

  return {
    family: family.toLowerCase(),
    major,
    minor: Number.isFinite(minor) ? minor : 0,
  };
}

/** True when `generation` is at or above `major.minor` (e.g. isAtLeast({major:4,minor:7}, 4, 6) === true). */
function isAtLeast(generation: AnthropicModelGeneration, major: number, minor: number): boolean {
  return generation.major > major || (generation.major === major && generation.minor >= minor);
}

function isOpusOrSonnet(generation: AnthropicModelGeneration): boolean {
  return generation.family === 'opus' || generation.family === 'sonnet';
}

/** Fable always keeps thinking on server-side and rejects any `thinking` param in the request. */
export function rejectsThinkingParam(model: string | undefined): boolean {
  const generation = getAnthropicModelGeneration(model);
  return generation?.family === 'fable';
}

/**
 * True once `{type:'adaptive'}` is a valid thinking mode for this model — from Opus/Sonnet
 * 4.6 onward. Fable never takes a thinking param at all (see {@link rejectsThinkingParam}),
 * and anything older than 4.6 only understands the legacy `enabled` + `budget_tokens` shape.
 */
export function supportsAdaptiveThinking(model: string | undefined): boolean {
  const generation = getAnthropicModelGeneration(model);
  if (!generation || !isOpusOrSonnet(generation)) {
    return false;
  }
  return isAtLeast(generation, 4, 6);
}

/**
 * True once `{type:'adaptive'}` is the *only* on-mode — `budget_tokens` returns 400.
 * Opus/Sonnet 4.7 and newer (including every 5.x). 4.6 still accepts (deprecated)
 * `budget_tokens`, so it is deliberately excluded.
 */
export function requiresAdaptiveThinkingOnly(model: string | undefined): boolean {
  const generation = getAnthropicModelGeneration(model);
  if (!generation || !isOpusOrSonnet(generation)) {
    return false;
  }
  return isAtLeast(generation, 4, 7);
}

/**
 * True when the model 400s on any sampling param (`temperature`, `top_p`, `top_k`) —
 * Fable (always-on thinking leaves no room for sampling) and every Opus/Sonnet 4.7+.
 * 4.6 and older still allow sampling normally.
 */
export function rejectsSamplingParams(model: string | undefined): boolean {
  return rejectsThinkingParam(model) || requiresAdaptiveThinkingOnly(model);
}

/**
 * True for the models that 400 on a forced `tool_choice` (`any`/`tool`) — Fable 5.1 and
 * Mythos 5.1 specifically. This is an exact-version quirk (Fable 5 itself is fine), not a
 * generation floor, so it does not extend to later 5.x minors automatically.
 */
export function rejectsForcedToolChoice(model: string | undefined): boolean {
  const generation = getAnthropicModelGeneration(model);
  if (!generation) {
    return false;
  }
  return (
    (generation.family === 'fable' || generation.family === 'mythos') &&
    generation.major === 5 &&
    generation.minor === 1
  );
}

export type AnthropicEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const ALL_EFFORT_LEVELS: AnthropicEffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const PRE_XHIGH_EFFORT_LEVELS: AnthropicEffortLevel[] = ['low', 'medium', 'high', 'max'];

/**
 * The `output_config.effort` values a model accepts, in the order Anthropic documents
 * them. Fable and every Opus/Sonnet 4.7+ (including 5.x) support the full range up to
 * `xhigh`; 4.6 supports the pre-`xhigh` range; anything older doesn't support effort at
 * all. A model that can't be parsed as an Anthropic generation (unrecognized id, or no
 * model supplied) gets the full range rather than an empty one, so callers that don't
 * thread a model through don't have valid effort values silently stripped.
 */
export function supportedEffortLevels(model: string | undefined): AnthropicEffortLevel[] {
  const generation = getAnthropicModelGeneration(model);
  if (!generation) {
    return model === undefined ? ALL_EFFORT_LEVELS : [];
  }

  if (generation.family === 'fable') {
    return ALL_EFFORT_LEVELS;
  }

  if (!isOpusOrSonnet(generation)) {
    return [];
  }

  if (isAtLeast(generation, 4, 7)) {
    return ALL_EFFORT_LEVELS;
  }

  if (isAtLeast(generation, 4, 6)) {
    return PRE_XHIGH_EFFORT_LEVELS;
  }

  return [];
}

/** Claude 4.x Opus or Sonnet (any minor) — scopes the interleaved-thinking beta logic below. */
export function isAnthropicClaude4Model(model: string | undefined): boolean {
  const generation = getAnthropicModelGeneration(model);
  return !!generation && generation.major === 4 && isOpusOrSonnet(generation);
}

/** Claude 4.x Opus specifically (any minor). */
export function isAnthropicClaude4OpusModel(model: string | undefined): boolean {
  const generation = getAnthropicModelGeneration(model);
  return !!generation && generation.major === 4 && generation.family === 'opus';
}

export function supportsTemperature(model: string): boolean {
  return !/(?:^|\/)(?:o[134]|gpt-5(?:\.|$))/i.test(model);
}

export function shouldSurfaceReasoning(_model: string): boolean {
  return true;
}

export function supportsGeminiStructuredOutputWithTools(
  model: string,
  provider?: Pick<LlmProviderConfig, 'capabilityHints'>,
): boolean {
  if (provider?.capabilityHints?.supportsStructuredOutput === false) {
    return false;
  }

  return GEMINI_STRUCTURED_OUTPUT_WITH_TOOLS_PATTERNS.some((pattern) => pattern.test(model));
}

export function resolveProviderCapabilities(
  provider: Pick<
    LlmProviderConfig,
    'kind' | 'local' | 'name' | 'baseUrl' | 'protocol' | 'providerFamily' | 'capabilityHints'
  >,
  model: string,
): {
  routing: ReturnType<typeof resolveProviderRouting>;
  supportsTemperature: boolean;
  supportsReasoningEffort: boolean;
  supportsGeminiStructuredOutputWithTools: boolean;
} {
  return {
    routing: resolveProviderRouting(provider),
    supportsTemperature: supportsTemperature(model),
    supportsReasoningEffort: isOpenAIReasoningModel(model),
    supportsGeminiStructuredOutputWithTools: supportsGeminiStructuredOutputWithTools(
      model,
      provider,
    ),
  };
}
