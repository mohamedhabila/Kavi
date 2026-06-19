import type { SkillToolDefinition } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';
import { getGitHubToolContract } from './toolContracts';

export function createGitHubApiTool(
  ...args: Parameters<typeof createApiTool>
): SkillToolDefinition {
  const [name, description, properties, required, handler, options] = args;
  return createApiTool(name, description, properties, required, handler, {
    ...options,
    contract: getGitHubToolContract(name),
  });
}
