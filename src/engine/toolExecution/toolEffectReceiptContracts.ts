import type { ToolEffectKind, ToolEffectResultContract } from '../../types/toolEffectReceipt';

export interface CodeOwnedToolEffectContract {
  readonly effectMode: 'none' | 'effectful';
  readonly effectKind: ToolEffectKind;
  readonly result?: ToolEffectResultContract;
}

// This registry is intentionally empty until first-party tools receive reviewed
// result semantics. Dynamic MCP/skill declarations are never trusted here.
const CODE_OWNED_TOOL_EFFECT_CONTRACTS: Readonly<Record<string, CodeOwnedToolEffectContract>> =
  Object.freeze({});

export function getCodeOwnedToolEffectContract(
  canonicalToolName: string,
): CodeOwnedToolEffectContract | undefined {
  return CODE_OWNED_TOOL_EFFECT_CONTRACTS[canonicalToolName];
}
