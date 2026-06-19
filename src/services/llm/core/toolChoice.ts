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
      ...(choice.disableParallelToolUse === true
        ? { disable_parallel_tool_use: true }
        : {}),
    };
  }

  if (choice === 'required' || isRequiredToolChoice(choice)) {
    return {
      type: 'any',
      ...(shouldDisableParallelToolUse(choice)
        ? { disable_parallel_tool_use: true }
        : {}),
    };
  }

  return { type: 'auto' };
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
