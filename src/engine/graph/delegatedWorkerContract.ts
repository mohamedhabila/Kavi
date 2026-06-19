import type { AgentGoal } from '../goals/types';
import { getGoalById } from '../goals/types';
import { buildGraphDelegatedWorkerPrompt } from './delegatedWorkerPrompt';

export interface GraphDelegatedWorkerContractInput {
  normalizedPrompt: string;
  goalId?: string;
  goals?: ReadonlyArray<AgentGoal>;
  configuredTools?: ReadonlyArray<string> | null;
  availableWorkerTools?: ReadonlyArray<string> | null;
}

export interface GraphDelegatedWorkerContract {
  prompt: string;
  source: 'graph' | 'model';
  workstreamId?: string;
  configuredTools?: string[];
}

export function buildGraphDelegatedWorkerContract(
  input: GraphDelegatedWorkerContractInput,
): GraphDelegatedWorkerContract {
  const goal = input.goalId ? getGoalById(input.goals ?? [], input.goalId) : null;
  const configuredTools = input.configuredTools ? [...input.configuredTools] : undefined;
  const availableWorkerTools = input.availableWorkerTools
    ? [...input.availableWorkerTools]
    : configuredTools
      ? [...configuredTools]
      : undefined;

  if (!goal) {
    return {
      prompt: input.normalizedPrompt,
      source: 'model',
      configuredTools,
    };
  }

  return {
    prompt: buildGraphDelegatedWorkerPrompt({
      id: goal.id,
      title: goal.title,
      goal: goal.description ?? goal.title,
      handoff: input.normalizedPrompt,
      requirements: goal.requiredCapabilities,
      successCriteria: goal.successCriteria,
      dependencies: goal.dependencies,
      availableWorkerTools,
    }),
    source: 'graph',
    workstreamId: goal.id,
    configuredTools,
  };
}