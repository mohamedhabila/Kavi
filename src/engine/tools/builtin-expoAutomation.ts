import { getExpoAutomationSummary } from '../../services/expo/projectAutomation';
import {
  resolveExpoAccount as resolveExpoAccountState,
  resolveExpoProject as resolveExpoProjectState,
} from '../../services/expo/projectState';
import { useSettingsStore } from '../../store/useSettingsStore';

export function getExpoProjectAutomationContext(projectId: string) {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProjectState(projectId, settings);
  const account = resolveExpoAccountState(project.accountId, settings);

  return {
    project,
    account,
    automation: getExpoAutomationSummary(project, account),
  };
}

export function withExpoAutomation<T extends object>(
  projectId: string,
  payload: T,
): T & {
  preferredFlow: ReturnType<typeof getExpoAutomationSummary>['preferredFlow'];
  automation: ReturnType<typeof getExpoAutomationSummary>;
} {
  const { automation } = getExpoProjectAutomationContext(projectId);
  return {
    ...payload,
    preferredFlow: automation.preferredFlow,
    automation,
  };
}

export function getExpoAutomationGuidance(
  automation: ReturnType<typeof getExpoAutomationSummary>,
): string {
  return automation.recommendedFlow.join(' ');
}
