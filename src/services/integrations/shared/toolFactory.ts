import type { SkillToolDefinition } from '../../skills/types';
import type { SkillToolExecutionContext } from '../../skills/types';
import { completedToolOutcome, failedToolOutcome } from '../../../types/toolRuntimeOutcome';

export type SkillToolHandler = NonNullable<SkillToolDefinition['handler']>;
type SuccessfulApiToolHandler = (args: any, context: SkillToolExecutionContext) => Promise<string>;

type ApiToolOptions = {
  strict?: boolean;
  additionalProperties?: boolean;
  contract?: SkillToolDefinition['contract'];
};

export function createApiTool(
  name: string,
  description: string,
  properties: Record<string, any>,
  required: string[],
  handler: SuccessfulApiToolHandler,
  options: ApiToolOptions = {},
): SkillToolDefinition {
  return {
    name,
    description,
    input_schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: options.additionalProperties ?? false,
    },
    strict: options.strict,
    contract: options.contract,
    handler: async (args, context) => {
      try {
        return completedToolOutcome(await handler(args, context));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failedToolOutcome(`Error: ${message}`);
      }
    },
  };
}
