// ---------------------------------------------------------------------------
// Kavi — what Anthropic's models API declares about each model
// ---------------------------------------------------------------------------
// The models API states, per model, whether it reads images and PDFs and which thinking
// modes and effort levels it accepts (capabilities.thinking.types, capabilities.effort).
// Requests follow those declarations instead of rules inferred from the model's id, so a
// model is requested the way it accepts the day it ships: Claude Sonnet 5.5 declares
// adaptive thinking only, Claude Haiku 4.5 manual (enabled) thinking only.
// https://platform.claude.com/docs/en/api/models
// ---------------------------------------------------------------------------

import { inferModelCapabilities } from '../../../../constants/api';
import type { ModelCapabilities, ModelReasoningCapability } from '../../../../types/tool';
import { isPlainRecord } from '../../core/json';

function supported(value: unknown): boolean {
  return isPlainRecord(value) && value.supported === true;
}

/** The options a `{ supported, <option>: { supported } }` declaration accepts. */
function supportedOptions(value: unknown): string[] {
  if (!isPlainRecord(value)) return [];
  return Object.entries(value)
    .filter(([name, option]) => name !== 'supported' && supported(option))
    .map(([name]) => name);
}

function declaredThinking(
  capabilities: Record<string, unknown>,
): ModelReasoningCapability | undefined {
  const thinking = capabilities.thinking;
  if (!supported(thinking)) return undefined;
  const thinkingModes = supportedOptions((thinking as Record<string, unknown>).types);
  if (thinkingModes.length === 0) return undefined;
  return {
    mandatory: !thinkingModes.includes('disabled'),
    supportedEfforts: supported(capabilities.effort) ? supportedOptions(capabilities.effort) : [],
    thinkingModes,
  };
}

/** A models API entry's declarations; what it does not declare is inferred from the id. */
export function resolveAnthropicModelCapabilities(
  entry: unknown,
  model: string,
): ModelCapabilities {
  const inferred = inferModelCapabilities(model);
  const capabilities =
    isPlainRecord(entry) && isPlainRecord(entry.capabilities) ? entry.capabilities : null;
  if (!capabilities) return inferred;
  const reasoning = declaredThinking(capabilities);
  return {
    vision: 'image_input' in capabilities ? supported(capabilities.image_input) : inferred.vision,
    tools: inferred.tools,
    fileInput: 'pdf_input' in capabilities ? supported(capabilities.pdf_input) : inferred.fileInput,
    ...(reasoning ? { reasoning } : {}),
  };
}
