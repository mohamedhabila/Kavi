import type { E2ERubric, E2EScenario } from './types';

type ArtifactTargetRubric = Extract<E2ERubric, { kind: 'workspace_file' | 'file_hash' }>;

function observableTaskText(scenario: E2EScenario): string {
  return [scenario.prompt, ...(scenario.userTurns ?? []).map((turn) => turn.content)].join('\n');
}

function isArtifactTargetObservable(taskText: string, path: string): boolean {
  if (taskText.includes(path)) return true;

  const segments = path.split('/').filter(Boolean);
  const filename = segments.at(-1) ?? '';
  const baseName = filename.split('.')[0] ?? '';
  const directory = segments.slice(0, -1).join('/');
  return Boolean(
    baseName && taskText.includes(baseName) && (!directory || taskText.includes(directory)),
  );
}

export function listUnobservableArtifactTargets(scenario: E2EScenario): string[] {
  const taskText = observableTaskText(scenario);
  return scenario.rubrics
    .filter(
      (rubric): rubric is ArtifactTargetRubric =>
        rubric.kind === 'workspace_file' || rubric.kind === 'file_hash',
    )
    .map((rubric) => rubric.path)
    .filter((path) => !isArtifactTargetObservable(taskText, path));
}

export function assertE2EScenarioArtifactTargetsObservable(scenario: E2EScenario): void {
  const hiddenTargets = listUnobservableArtifactTargets(scenario);
  if (hiddenTargets.length > 0) {
    throw new Error(`e2e_unobservable_artifact_target:${scenario.id}:${hiddenTargets.join(',')}`);
  }
}
