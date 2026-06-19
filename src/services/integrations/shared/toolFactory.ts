import type { SkillToolDefinition } from '../../skills/types';

export type SkillToolHandler = NonNullable<SkillToolDefinition['handler']>;

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
  handler: SkillToolHandler,
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
    handler,
  };
}
