// ---------------------------------------------------------------------------
// Kavi — Reasoning effort resolution from declared model capabilities
// ---------------------------------------------------------------------------
// A request's reasoning control must be one the target model accepts. Aggregated
// endpoints such as OpenRouter serve models with different rules: some cannot turn
// reasoning off at all and reject `effort: none` with a 400, others accept only a
// subset of effort levels. When the provider declares those rules for a model
// (`ModelCapabilities.reasoning`, recorded by model discovery), the request is built
// from them; when it declares nothing, the request carries no control, which every
// model accepts.
// ---------------------------------------------------------------------------

import type { LlmProviderConfig, ThinkingLevelPreference } from '../../../types/provider';
import type { ModelReasoningCapability } from '../../../types/tool';
import { resolveProviderFamily } from '../catalog/providerFamilies';
import type { ReasoningEffort } from './contracts';

/** Every effort name a provider may declare, from least to most deliberation. */
const DECLARED_EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** The subset this client's request options can carry. */
const REQUESTABLE_EFFORTS: ReadonlySet<string> = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const THINKING_LEVEL_EFFORT: Record<ThinkingLevelPreference, ReasoningEffort> = {
  off: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
};

function effortRank(effort: string): number {
  return DECLARED_EFFORT_ORDER.indexOf(effort);
}

/**
 * The efforts a request may carry for this model, least deliberation first. `none` is
 * available exactly when reasoning is not mandatory, whether or not it is listed: a
 * model that can turn reasoning off accepts the request to do so.
 */
function requestableEfforts(capability: ModelReasoningCapability): ReasoningEffort[] {
  const efforts = new Set(
    capability.supportedEfforts.filter(
      (effort) => REQUESTABLE_EFFORTS.has(effort) && effort !== 'none',
    ),
  );
  if (!capability.mandatory) {
    efforts.add('none');
  }
  return Array.from(efforts).sort(
    (left, right) => effortRank(left) - effortRank(right),
  ) as ReasoningEffort[];
}

export function getDeclaredReasoningCapability(
  provider: Pick<LlmProviderConfig, 'modelCapabilities'>,
  model: string,
): ModelReasoningCapability | undefined {
  return provider.modelCapabilities?.[model]?.reasoning;
}

/**
 * The accepted effort closest to `requested`: the least deliberate one at or above it,
 * or the most deliberate one below it when the model offers nothing that high.
 * Undefined when the model declares no effort this client can request.
 */
export function resolveDeclaredReasoningEffort(
  capability: ModelReasoningCapability,
  requested: ReasoningEffort,
): ReasoningEffort | undefined {
  const efforts = requestableEfforts(capability);
  const target = effortRank(requested);
  return efforts.find((effort) => effortRank(effort) >= target) ?? efforts[efforts.length - 1];
}

/** The effort that honours a user's thinking level on a model that declares its efforts. */
export function resolveThinkingLevelReasoningEffort(
  capability: ModelReasoningCapability,
  level: ThinkingLevelPreference,
): ReasoningEffort | undefined {
  return resolveDeclaredReasoningEffort(capability, THINKING_LEVEL_EFFORT[level]);
}

/**
 * Reasoning control for a short helper request that needs little deliberation —
 * memory extraction, memory reranking, admission and finalization checks.
 *
 * - The model declares its efforts: the least deliberate one it accepts.
 * - An OpenRouter model that declares nothing: no control. OpenRouter rejects `none`
 *   for models that cannot turn reasoning off, and omitting the control is accepted by
 *   every model it serves.
 * - Any other provider: `none`, which each family's adapter maps to its own off switch.
 */
export function resolveHelperReasoningEffort(
  provider: Pick<LlmProviderConfig, 'modelCapabilities' | 'name' | 'baseUrl' | 'providerFamily'>,
  model: string,
): ReasoningEffort | undefined {
  const capability = getDeclaredReasoningCapability(provider, model);
  if (capability) {
    return resolveDeclaredReasoningEffort(capability, 'none');
  }
  return resolveProviderFamily(provider) === 'openrouter' ? undefined : 'none';
}
