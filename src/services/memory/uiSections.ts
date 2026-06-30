import type { AccessibilityNode, UiControl } from './uiState';

export interface UiSectionSummary {
  label: string;
  landmarkRole?: string;
  controlNames: string[];
  textSnippets: string[];
  structuralPath: UiSectionStructuralPathItem[];
  controlCount: number;
  firstControlIndex: number;
}

export interface UiSectionStructuralPathItem {
  role: string;
  label?: string;
}

const MAX_SECTIONS = 48;
const MAX_SECTION_CONTROLS = 64;
const MAX_SECTION_TEXT_SNIPPETS = 8;
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
const SECTION_TEXT_ROLES = new Set(['statictext', 'text', 'time']);
const STRUCTURAL_PATH_ROLES = new Set([
  'application',
  'banner',
  'complementary',
  'contentinfo',
  'dialog',
  'form',
  'main',
  'navigation',
  'region',
  'section',
  'tabpanel',
]);
const LANDMARK_ROLES = new Set([
  'application',
  'banner',
  'complementary',
  'contentinfo',
  'dialog',
  'form',
  'main',
  'navigation',
  'region',
  'search',
]);

type SectionAccumulator = {
  label: string;
  controls: string[];
  texts: string[];
  structuralPath: UiSectionStructuralPathItem[];
  seenControls: Set<string>;
  seenTexts: Set<string>;
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

function addTextSnippet(
  section: SectionAccumulator,
  name: string | null,
  controlNameKeys: ReadonlySet<string>,
): void {
  const trimmed = name?.normalize('NFKC').trim();
  if (!trimmed) return;
  const key = normalizedKey(trimmed);
  if (section.seenTexts.has(key) || controlNameKeys.has(key)) return;
  section.seenTexts.add(key);
  if (section.texts.length < MAX_SECTION_TEXT_SNIPPETS) section.texts.push(trimmed);
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
    const controlNameKeys = new Set(
      controlIndexes
        .map((controlIndex) => controlsByIndex.get(controlIndex)?.name)
        .filter((name): name is string => Boolean(name?.trim()))
        .map(normalizedKey),
    );
    const key = normalizedKey(trimmedLabel);
    const section =
      byLabel.get(key) ??
      {
        label: trimmedLabel,
        controls: [],
        texts: [],
        structuralPath: structuralPathForSection(nodes, node.index),
        seenControls: new Set<string>(),
        seenTexts: new Set<string>([key]),
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
    for (const text of textSnippetsInSection(nodes, node.index, controlsByIndex)) {
      addTextSnippet(section, text, controlNameKeys);
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
      landmarkRole: landmarkRoleForSection(section.structuralPath),
      controlNames: section.controls,
      textSnippets: section.texts,
      structuralPath: section.structuralPath,
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

function textSnippetsInSection(
  nodes: ReadonlyArray<AccessibilityNode>,
  sectionIndex: number,
  controlsByIndex: ReadonlyMap<number, UiControl>,
): string[] {
  const endIndex = sectionEndIndex(nodes, sectionIndex);
  const snippets: string[] = [];
  const seen = new Set<string>();
  for (let index = sectionIndex + 1; index < endIndex; index += 1) {
    const node = nodes[index];
    if (controlsByIndex.has(index) || isSectionLabelNode(node)) continue;
    if (!SECTION_TEXT_ROLES.has(node.role.toLocaleLowerCase())) continue;
    const trimmed = node.name?.normalize('NFKC').trim();
    if (!trimmed) continue;
    const key = normalizedKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(trimmed);
    if (snippets.length >= MAX_SECTION_TEXT_SNIPPETS) break;
  }
  return snippets;
}

function structuralPathForSection(
  nodes: ReadonlyArray<AccessibilityNode>,
  sectionIndex: number,
): UiSectionStructuralPathItem[] {
  const section = nodes[sectionIndex];
  if (!section) return [];
  const path: UiSectionStructuralPathItem[] = [];
  let ancestorIndent = section.indent;
  for (let index = sectionIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.indent >= ancestorIndent) continue;
    ancestorIndent = node.indent;
    const role = node.role.toLocaleLowerCase();
    if (STRUCTURAL_PATH_ROLES.has(role)) {
      path.push({
        role: node.role,
        ...(node.name?.trim() ? { label: node.name.trim() } : {}),
      });
    }
    if (ancestorIndent === 0) break;
  }
  return path.reverse();
}

function landmarkRoleForSection(
  structuralPath: ReadonlyArray<UiSectionStructuralPathItem>,
): string | undefined {
  const firstLandmark = structuralPath.find((item) =>
    LANDMARK_ROLES.has(item.role.toLocaleLowerCase()),
  );
  return firstLandmark?.role;
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
    if (sectionRole === 'heading' && node.role === 'LabelText') return index;
    if (sectionRole !== 'heading') return index;
  }
  return nodes.length;
}

export function compactUiSection(section: UiSectionSummary): Record<string, unknown> {
  return {
    label: section.label,
    landmarkRole: section.landmarkRole,
    structuralPath: section.structuralPath.length > 0 ? section.structuralPath : undefined,
    controlNames: section.controlNames,
    textSnippets: section.textSnippets.length > 0 ? section.textSnippets : undefined,
    controlCount: section.controlCount,
    firstControlIndex: section.firstControlIndex,
  };
}
