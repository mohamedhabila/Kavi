import type { ToolChoiceMode } from '../support/contracts';
import { isPlainRecord } from './json';

export function isExactToolChoice(
  choice: ToolChoiceMode | undefined,
): choice is Extract<ToolChoiceMode, { type: 'tool' }> {
  return (
    isPlainRecord(choice) &&
    choice.type === 'tool' &&
    typeof choice.name === 'string' &&
    choice.name.trim().length > 0
  );
}

export function isRequiredToolChoice(
  choice: ToolChoiceMode | undefined,
): choice is Extract<ToolChoiceMode, { type: 'required' }> {
  return isPlainRecord(choice) && choice.type === 'required';
}

export function isForcedToolChoice(choice: ToolChoiceMode | undefined): boolean {
  return choice === 'required' || isRequiredToolChoice(choice) || isExactToolChoice(choice);
}

export function shouldDisableParallelToolUse(choice: ToolChoiceMode | undefined): boolean {
  return (
    (isExactToolChoice(choice) || isRequiredToolChoice(choice)) &&
    choice.disableParallelToolUse === true
  );
}

export function buildOpenAIToolChoice(
  choice: ToolChoiceMode | undefined,
): Record<string, any> | string | undefined {
  if (!choice) {
    return undefined;
  }

  if (isExactToolChoice(choice)) {
    return {
      type: 'function',
      name: choice.name.trim(),
    };
  }

  if (choice === 'required' || isRequiredToolChoice(choice)) {
    return 'required';
  }

  return choice;
}

export function buildCompatibleToolChoice(
  choice: ToolChoiceMode | undefined,
): Record<string, any> | string | undefined {
  if (!choice) {
    return undefined;
  }

  if (isExactToolChoice(choice)) {
    return {
      type: 'function',
      function: {
        name: choice.name.trim(),
      },
    };
  }

  if (choice === 'required' || isRequiredToolChoice(choice)) {
    return 'required';
  }

  return choice;
}

export function buildAnthropicToolChoice(
  choice: ToolChoiceMode | undefined,
): Record<string, any> | undefined {
  if (!choice) {
    return undefined;
  }

  if (isExactToolChoice(choice)) {
    return {
      type: 'tool',
      name: choice.name.trim(),
      ...(choice.disableParallelToolUse === true ? { disable_parallel_tool_use: true } : {}),
    };
  }

  if (choice === 'required' || isRequiredToolChoice(choice)) {
    return {
      type: 'any',
      ...(shouldDisableParallelToolUse(choice) ? { disable_parallel_tool_use: true } : {}),
    };
  }

  return { type: 'auto' };
}

export interface ForcedToolChoiceFallback {
  /** Always `'auto'` — the downgraded choice to send in place of the rejected forced one. */
  toolChoice: Extract<ToolChoiceMode, 'auto'>;
  /** A short system instruction naming the tool(s) the forced choice would have required. */
  instruction: string;
}

/**
 * Converts a forced `tool_choice` (`required`/exact `tool`) into `{type:'auto'}` plus a
 * system instruction naming the required tool, for providers/models that 400 on a forced
 * choice (e.g. Anthropic Fable 5.1 — see `rejectsForcedToolChoice` in
 * `catalog/providerCapabilities`). Returns undefined when `choice` isn't forced, since
 * there is nothing to convert.
 */
export function resolveForcedToolChoiceFallback(
  choice: ToolChoiceMode | undefined,
  tools: ReadonlyArray<{ name: string }> | undefined,
): ForcedToolChoiceFallback | undefined {
  if (!isForcedToolChoice(choice)) {
    return undefined;
  }

  if (isExactToolChoice(choice)) {
    return {
      toolChoice: 'auto',
      instruction: `You must call the \`${choice.name.trim()}\` tool before responding to the user in this turn.`,
    };
  }

  const toolNames = (tools ?? [])
    .map((tool) => tool.name?.trim())
    .filter((name): name is string => Boolean(name));

  return {
    toolChoice: 'auto',
    instruction:
      toolNames.length > 0
        ? `You must call one of the following tools before responding to the user in this turn: ${toolNames.join(', ')}.`
        : 'You must call one of the available tools before responding to the user in this turn.',
  };
}

export function buildGeminiFunctionCallingConfig(
  choice: ToolChoiceMode | undefined,
): Record<string, any> | undefined {
  if (!choice) {
    return {
      mode: 'AUTO',
    };
  }

  if (isExactToolChoice(choice)) {
    return {
      mode: 'ANY',
      allowedFunctionNames: [choice.name.trim()],
    };
  }

  return {
    mode: choice === 'required' || isRequiredToolChoice(choice) ? 'ANY' : 'AUTO',
  };
}
