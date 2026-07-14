import type { ReasoningEffort } from '../../support/contracts';

export function applyCompatibleReasoningControl(params: {
  body: Record<string, unknown>;
  effort: ReasoningEffort | undefined;
  isOpenAIReasoningModel: boolean;
  isOpenRouterProvider: boolean;
}): void {
  if (!params.effort) return;

  if (params.isOpenRouterProvider) {
    params.body.reasoning = { effort: params.effort };
    return;
  }

  if (params.isOpenAIReasoningModel) {
    params.body.reasoning_effort = params.effort;
  }
}
