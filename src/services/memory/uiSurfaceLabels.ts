import type { UiSectionSummary } from './uiSections';
import type { UiControl } from './uiState';

const MAX_SURFACE_LABELS = 24;

function uniqueNamedValues(values: Array<string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_SURFACE_LABELS) break;
  }
  return out;
}

export function extractSurfaceLabels(
  controls: ReadonlyArray<UiControl>,
  sections: ReadonlyArray<UiSectionSummary>,
): string[] {
  const labels = new Map<
    string,
    { label: string; count: number; score: number; firstControlIndex: number }
  >();
  const add = (
    value: string | null | undefined,
    score: number,
    firstControlIndex: number,
  ): void => {
    const label = value?.trim();
    if (!label) return;
    const existing = labels.get(label);
    if (existing) {
      existing.count += 1;
      existing.score = Math.max(existing.score, score);
      existing.firstControlIndex = Math.min(existing.firstControlIndex, firstControlIndex);
      return;
    }
    labels.set(label, { label, count: 1, score, firstControlIndex });
  };
  for (const control of controls) {
    for (const contextLabel of control.contextLabels) add(contextLabel, 0, control.index);
  }
  for (const section of sections) {
    const structuralRoles = section.structuralPath.map((item) => item.role.toLocaleLowerCase());
    const structuralScore = structuralRoles.includes('main')
      ? 8
      : structuralRoles.length > 0
        ? 4
        : 0;
    const densityScore = Math.min(section.controlCount, 16) / 16;
    add(section.label, structuralScore + densityScore, section.firstControlIndex);
  }
  return uniqueNamedValues(
    Array.from(labels.values())
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (right.count !== left.count) return right.count - left.count;
        return left.firstControlIndex - right.firstControlIndex;
      })
      .map((entry) => entry.label),
  );
}
