import type { LlmProviderConfig } from '../../../types/provider';
import type { ModelReasoningCapability } from '../../../types/tool';
import { resolveProviderRouting, resolveProviderTransport, type ProviderTransport } from './providerProtocols';
import { normalizeHostedModelId, resolveModelHostedFamily } from './providerFamilies';

/** The major version in a `gpt-<major>` id (gpt-6-astra is 6, gpt-5.5 is 5), if it has one. */
function openAIGptMajor(model: string): number | undefined {
  const match = /^gpt-(\d+)(?:[.-]|$)/i.exec(normalizeHostedModelId(model));
  return match ? Number(match[1]) : undefined;
}

/** OpenAI's reasoning models: the o-series and every GPT from 5 on. */
export function isOpenAIReasoningModel(model: string): boolean {
  return (
    /^o[134](?:[.-]|$)/i.test(normalizeHostedModelId(model)) || (openAIGptMajor(model) ?? 0) >= 5
  );
}

/**
 * The reasoning efforts an OpenAI reasoning model accepts. OpenAI's models API declares
 * nothing, so this reads the generation, as the live API answered on 2026-10-14: GPT-6
 * accepts low through max (every GPT-6 model rejects minimal, and Astra and 6.1 Sol reject
 * none), and the earlier reasoning models all accept low, medium and high.
 */
export function inferOpenAIReasoningCapability(
  model: string,
): ModelReasoningCapability | undefined {
  if (!isOpenAIReasoningModel(model)) return undefined;
  return {
    mandatory: true,
    supportedEfforts:
      (openAIGptMajor(model) ?? 0) >= 6
        ? ['low', 'medium', 'high', 'xhigh', 'max']
        : ['low', 'medium', 'high'],
  };
}

/**
 * Gemini 3 and later (3, 3.x, 4, ...): thinking levels instead of budgets, thought signatures
 * that function calling requires back, structured output alongside tools, and sampling left
 * at its default. Read from the generation, so Gemini 3.8 and 4 are covered the day they ship.
 */
export function isGemini3OrLaterModel(model: string | undefined): boolean {
  if (resolveModelHostedFamily(model) !== 'gemini') return false;
  const match = /^gemini-(\d+)(?:[.-]|$)/i.exec(normalizeHostedModelId(model));
  return match ? Number(match[1]) >= 3 : false;
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

/**
 * True when the model 400s on any sampling param (`temperature`, `top_p`, `top_k`):
 * "`temperature` is deprecated for this model". Every Claude 5.x model (Sonnet, Opus,
 * Haiku, Fable) and Opus/Sonnet 4.7 and 4.8; 4.6 and older accept sampling. Anthropic's
 * models API declares nothing about sampling, so this one rule reads the id (checked live
 * on 2026-10-15 against sonnet-5, sonnet-5-5, opus-5-5, haiku-5-5, fable-5-1, sonnet-4-6
 * and haiku-4-5).
 */
export function rejectsSamplingParams(model: string | undefined): boolean {
  const generation = getAnthropicModelGeneration(model);
  if (!generation) return false;
  return generation.major >= 5 || (isOpusOrSonnet(generation) && isAtLeast(generation, 4, 7));
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

/**
 * Whether a request may set a temperature. Every OpenAI reasoning model rejects sampling
 * parameters alongside a reasoning effort; Gemini 3 is meant to run at its default and
 * Gemini 4 ignores them.
 */
export function supportsTemperature(model: string): boolean {
  return !isOpenAIReasoningModel(model) && !isGemini3OrLaterModel(model);
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

  return isGemini3OrLaterModel(model);
}

/**
 * Transports whose request shape has a provider-native document content block: Anthropic's
 * `document` block, Gemini's `inlineData`, and OpenAI's Responses `input_file`. OpenAI Chat
 * Completions (transport `'compatible'`), on-device runtimes (`'local'`), and any other
 * OpenAI-compatible provider have no such block — a document sent there would either be
 * silently ignored by the wire format or rejected by the endpoint, so they're excluded even
 * when the model's own `fileInput` flag is true.
 */
const DOCUMENT_INPUT_TRANSPORTS: ReadonlySet<ProviderTransport> = new Set(['anthropic', 'gemini', 'openai']);

/**
 * True when `model` on `provider` can receive a document (PDF) attachment as a provider-native
 * content block rather than only a filename/size summary. Mirrors the `vision` capability gate
 * used for images (`provider.modelCapabilities?.[model]?.vision === true`), reusing the
 * already-discovered `fileInput` flag (see `modelDiscovery.ts`) plus a transport check, since
 * `fileInput` alone doesn't distinguish "this model understands documents" from "this specific
 * wire protocol has a document content block to carry one in".
 */
export function supportsDocumentInput(
  provider: Pick<
    LlmProviderConfig,
    | 'kind'
    | 'local'
    | 'name'
    | 'baseUrl'
    | 'protocol'
    | 'providerFamily'
    | 'capabilityHints'
    | 'modelCapabilities'
  >,
  model: string,
): boolean {
  if (provider.modelCapabilities?.[model]?.fileInput !== true) {
    return false;
  }
  return DOCUMENT_INPUT_TRANSPORTS.has(resolveProviderTransport(provider));
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
