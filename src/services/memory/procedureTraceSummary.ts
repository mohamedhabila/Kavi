const MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES = 16;
const MAX_PROCEDURE_ACTION_TRANSITIONS = 12;
const MAX_PROCEDURE_SURFACE_LABELS = 6;

function fitText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed || maxChars <= 0) return '';
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, maxChars);
  return `${trimmed.slice(0, maxChars - 3).trimEnd()}...`;
}

function dropEmptyRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    }),
  );
}

export function compactProcedureTraceTargetControl(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const compact = dropEmptyRecord({
    nodeId: typeof input.nodeId === 'string' ? fitText(input.nodeId, 80) : undefined,
    role: typeof input.role === 'string' ? fitText(input.role, 80) : undefined,
    name: typeof input.name === 'string' ? fitText(input.name, 160) : undefined,
    peerNames: Array.isArray(input.peerNames)
      ? input.peerNames
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => fitText(entry, 160))
          .slice(0, 8)
      : undefined,
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function compactSurfaceTrailStep(step: unknown): Record<string, unknown> | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  const input = step as Record<string, unknown>;
  const stateIndex = input.stateIndex ?? input.state_index;
  const url = input.url;
  const action = input.action;
  const targetControl = compactProcedureTraceTargetControl(input.targetControl);
  const surfaceLabels = Array.isArray(input.surfaceLabels)
    ? input.surfaceLabels
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => fitText(entry, 160))
        .slice(0, MAX_PROCEDURE_SURFACE_LABELS)
    : undefined;
  const compact = dropEmptyRecord({
    stateIndex:
      typeof stateIndex === 'string'
        ? fitText(stateIndex, 24)
        : typeof stateIndex === 'number'
          ? stateIndex
          : undefined,
    url: typeof url === 'string' ? fitText(url, 220) : undefined,
    action: typeof action === 'string' ? fitText(action, 120) : undefined,
    targetControl,
    surfaceLabels,
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function sameSurfaceTrailEntry(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean {
  if (!left || !right) return false;
  return (
    left.stateIndex === right.stateIndex &&
    left.url === right.url &&
    left.action === right.action &&
    surfaceLabelsKey(left) === surfaceLabelsKey(right)
  );
}

function surfaceLabelsKey(entry: Record<string, unknown>): string | null {
  const surfaceLabels = entry.surfaceLabels;
  if (!Array.isArray(surfaceLabels)) return null;
  const labels = surfaceLabels.filter((label): label is string => typeof label === 'string');
  return labels.length > 0 ? JSON.stringify(labels) : null;
}

function capSurfaceTrail(trail: Record<string, unknown>[]): Record<string, unknown>[] {
  if (trail.length <= MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES) return trail;
  const headCount = Math.ceil(MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES / 2);
  const tailCount = Math.floor(MAX_PROCEDURE_SURFACE_TRAIL_ENTRIES / 2);
  const capped: Record<string, unknown>[] = [];
  for (const entry of [...trail.slice(0, headCount), ...trail.slice(-tailCount)]) {
    if (sameSurfaceTrailEntry(capped[capped.length - 1] ?? null, entry)) continue;
    capped.push(entry);
  }
  return capped;
}

function capActionTransitions(transitions: Record<string, unknown>[]): Record<string, unknown>[] {
  if (transitions.length <= MAX_PROCEDURE_ACTION_TRANSITIONS) return transitions;
  const headCount = Math.ceil(MAX_PROCEDURE_ACTION_TRANSITIONS / 2);
  const tailCount = Math.floor(MAX_PROCEDURE_ACTION_TRANSITIONS / 2);
  return [...transitions.slice(0, headCount), ...transitions.slice(-tailCount)];
}

export function compactProcedureTraceActionTransitions(
  steps: unknown,
): Record<string, unknown>[] | null {
  if (!Array.isArray(steps)) return null;
  const transitions: Record<string, unknown>[] = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    const fromStep = steps[index];
    const toStep = steps[index + 1];
    if (
      !fromStep ||
      typeof fromStep !== 'object' ||
      Array.isArray(fromStep) ||
      !toStep ||
      typeof toStep !== 'object' ||
      Array.isArray(toStep)
    ) {
      continue;
    }
    const from = fromStep as Record<string, unknown>;
    const to = toStep as Record<string, unknown>;
    const action = to.action;
    if (typeof action !== 'string' || !action.trim()) continue;
    const fromStateIndex = from.stateIndex ?? from.state_index;
    const toStateIndex = to.stateIndex ?? to.state_index;
    const transition = dropEmptyRecord({
      fromStateIndex:
        typeof fromStateIndex === 'string'
          ? fitText(fromStateIndex, 24)
          : typeof fromStateIndex === 'number'
            ? fromStateIndex
            : undefined,
      observedAction: fitText(action, 120),
      targetControl: compactProcedureTraceTargetControl(to.targetControl),
      fromUrl: typeof from.url === 'string' ? fitText(from.url, 180) : undefined,
      toStateIndex:
        typeof toStateIndex === 'string'
          ? fitText(toStateIndex, 24)
          : typeof toStateIndex === 'number'
            ? toStateIndex
            : undefined,
      toUrl: typeof to.url === 'string' ? fitText(to.url, 180) : undefined,
    });
    if (Object.keys(transition).length > 0) transitions.push(transition);
  }
  return transitions.length > 0 ? capActionTransitions(transitions) : null;
}

export function compactProcedureTraceSurfaceTrail(
  steps: unknown,
): Record<string, unknown>[] | null {
  if (!Array.isArray(steps)) return null;
  const trail: Record<string, unknown>[] = [];
  let lastUrl: string | null = null;
  let lastSurfaceLabelsKey: string | null = null;
  let finalEntry: Record<string, unknown> | null = null;
  for (const step of steps) {
    const entry = compactSurfaceTrailStep(step);
    if (!entry) continue;
    finalEntry = entry;
    const url = typeof entry.url === 'string' ? entry.url : null;
    const currentSurfaceLabelsKey = surfaceLabelsKey(entry);
    if (
      trail.length === 0 ||
      (url && url !== lastUrl) ||
      (currentSurfaceLabelsKey && currentSurfaceLabelsKey !== lastSurfaceLabelsKey)
    ) {
      if (!sameSurfaceTrailEntry(trail[trail.length - 1] ?? null, entry)) {
        trail.push(entry);
      }
    }
    if (url) lastUrl = url;
    if (currentSurfaceLabelsKey) lastSurfaceLabelsKey = currentSurfaceLabelsKey;
  }
  if (finalEntry && !sameSurfaceTrailEntry(trail[trail.length - 1] ?? null, finalEntry)) {
    trail.push(finalEntry);
  }
  return trail.length > 0 ? capSurfaceTrail(trail) : null;
}
