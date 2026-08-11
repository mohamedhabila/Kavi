import type { AgentGoal } from '../goals/types';
import { getGoalById } from '../goals/types';
import { resolveWorkerVisibleSuccessCriteria } from '../goals/delegation';
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
      // The delegating goal's criteria include evidence.prefix:worker, which only the
      // supervisor can satisfy. Handing it to the worker taught it to gate its own goal on
      // a fact it can never record, and a traced run stalled there with its deliverable
      // already written.
      successCriteria: resolveWorkerVisibleSuccessCriteria(goal.successCriteria),
      userConstraints: goal.userConstraints?.map((constraint) => constraint.text),
      dependencies: goal.dependencies,
      availableWorkerTools,
    }),
    source: 'graph',
    workstreamId: goal.id,
    configuredTools,
  };
}
