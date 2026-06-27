import type { AccessibilityNode, UiControl } from './uiState';

export interface UiSectionSummary {
  label: string;
  controlNames: string[];
  controlCount: number;
  firstControlIndex: number;
}

const MAX_SECTIONS = 48;
const MAX_SECTION_CONTROLS = 64;
const SECTION_LABEL_ROLES = new Set([
  'article',
  'complementary',
  'group',
  'heading',
  'main',
  'navigation',
  'region',
  'section',
]);

type SectionAccumulator = {
  label: string;
  controls: string[];
  seenControls: Set<string>;
  controlCount: number;
  firstControlIndex: number;
};

function normalizedKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

function addControlName(section: SectionAccumulator, name: string | null): void {
  const trimmed = name?.normalize('NFKC').trim();
  if (!trimmed) return;
  const key = normalizedKey(trimmed);
  if (section.seenControls.has(key)) return;
  section.seenControls.add(key);
  if (section.controls.length < MAX_SECTION_CONTROLS) section.controls.push(trimmed);
}

export function extractUiSectionsFromControls(
  nodes: ReadonlyArray<AccessibilityNode>,
  controls: ReadonlyArray<UiControl>,
): UiSectionSummary[] {
  const byLabel = new Map<string, SectionAccumulator>();
  const controlsByIndex = new Map(controls.map((control) => [control.index, control]));
  for (const node of nodes) {
    if (!isSectionLabelNode(node)) continue;
    const trimmedLabel = node.name?.normalize('NFKC').trim();
    if (!trimmedLabel) continue;
    const controlIndexes = controlIndexesInSection(nodes, node.index, controlsByIndex);
    if (controlIndexes.length === 0) continue;
    const key = normalizedKey(trimmedLabel);
    const section =
      byLabel.get(key) ??
      {
        label: trimmedLabel,
        controls: [],
        seenControls: new Set<string>(),
        controlCount: 0,
        firstControlIndex: controlIndexes[0],
      };
    for (const controlIndex of controlIndexes) {
      const control = controlsByIndex.get(controlIndex);
      if (!control) continue;
      section.controlCount += 1;
      section.firstControlIndex = Math.min(section.firstControlIndex, control.index);
      addControlName(section, control.name);
    }
    byLabel.set(key, section);
  }
  return Array.from(byLabel.values())
    .sort((left, right) => {
      if (left.firstControlIndex !== right.firstControlIndex) {
        return left.firstControlIndex - right.firstControlIndex;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, MAX_SECTIONS)
    .map((section) => ({
      label: section.label,
      controlNames: section.controls,
      controlCount: section.controlCount,
      firstControlIndex: section.firstControlIndex,
    }));
}

function isSectionLabelNode(node: AccessibilityNode): boolean {
  return Boolean(node.name?.trim()) && SECTION_LABEL_ROLES.has(node.role.toLocaleLowerCase());
}

function controlIndexesInSection(
  nodes: ReadonlyArray<AccessibilityNode>,
  sectionIndex: number,
  controlsByIndex: ReadonlyMap<number, UiControl>,
): number[] {
  const section = nodes[sectionIndex];
  if (!section) return [];
  const endIndex = sectionEndIndex(nodes, sectionIndex);
  const indexes: number[] = [];
  for (let index = sectionIndex + 1; index < endIndex; index += 1) {
    if (controlsByIndex.has(index)) indexes.push(index);
  }
  return indexes;
}

function sectionEndIndex(nodes: ReadonlyArray<AccessibilityNode>, sectionIndex: number): number {
  const section = nodes[sectionIndex];
  if (!section) return sectionIndex + 1;
  const sectionRole = section.role.toLocaleLowerCase();
  for (let index = sectionIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.indent < section.indent) return index;
    if (node.indent !== section.indent) continue;
    if (isSectionLabelNode(node)) return index;
    if (sectionRole !== 'heading') return index;
  }
  return nodes.length;
}

export function compactUiSection(section: UiSectionSummary): Record<string, unknown> {
  return {
    label: section.label,
    controlNames: section.controlNames,
    controlCount: section.controlCount,
    firstControlIndex: section.firstControlIndex,
  };
}
