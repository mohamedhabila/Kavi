const MAX_ATTRIBUTE_DEPTH = 4;
const MAX_ATTRIBUTE_NODES = 128;
const MAX_ARRAY_ITEMS = 32;
const MAX_OBJECT_ENTRIES = 64;
const MAX_FIELD_CHARS = 200;
const MAX_STRING_CHARS = 1_000;
const MAX_TOTAL_TEXT_CHARS = 8_000;

export interface MemorySensitivityAttributeProjection {
  fieldNames: string[];
  values: string[];
  truncated: boolean;
}

interface TraversalState extends MemorySensitivityAttributeProjection {
  nodeCount: number;
  textChars: number;
  seen: WeakSet<object>;
}

function addText(target: string[], value: string, limit: number, state: TraversalState): void {
  if (value.length > limit || state.textChars + value.length > MAX_TOTAL_TEXT_CHARS) {
    state.truncated = true;
    return;
  }
  state.textChars += value.length;
  target.push(value);
}

function visit(value: unknown, depth: number, state: TraversalState): void {
  state.nodeCount += 1;
  if (state.nodeCount > MAX_ATTRIBUTE_NODES) {
    state.truncated = true;
    return;
  }
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    addText(state.values, value, MAX_STRING_CHARS, state);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) state.truncated = true;
    else addText(state.values, String(value), MAX_STRING_CHARS, state);
    return;
  }
  if (typeof value !== 'object') {
    state.truncated = true;
    return;
  }
  if (state.seen.has(value)) {
    state.truncated = true;
    return;
  }
  state.seen.add(value);
  if (depth >= MAX_ATTRIBUTE_DEPTH) {
    state.truncated = true;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) state.truncated = true;
    for (const entry of value.slice(0, MAX_ARRAY_ITEMS)) visit(entry, depth + 1, state);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    state.truncated = true;
    return;
  }
  let entries: Array<[string, unknown]>;
  try {
    entries = Object.entries(value as Record<string, unknown>);
  } catch {
    state.truncated = true;
    return;
  }
  if (entries.length > MAX_OBJECT_ENTRIES) state.truncated = true;
  for (const [field, entry] of entries.slice(0, MAX_OBJECT_ENTRIES)) {
    addText(state.fieldNames, field, MAX_FIELD_CHARS, state);
    visit(entry, depth + 1, state);
  }
}

/**
 * Project bounded attribute keys and values for sensitivity classification.
 * Any incomplete traversal is explicit so callers can fail closed.
 */
export function projectMemorySensitivityAttributes(
  attributes: Record<string, unknown> | undefined,
): MemorySensitivityAttributeProjection {
  const state: TraversalState = {
    fieldNames: [],
    values: [],
    truncated: false,
    nodeCount: 0,
    textChars: 0,
    seen: new WeakSet(),
  };
  if (attributes !== undefined) {
    let validRoot = false;
    try {
      const prototype =
        attributes !== null && typeof attributes === 'object'
          ? Object.getPrototypeOf(attributes)
          : undefined;
      validRoot =
        attributes !== null &&
        !Array.isArray(attributes) &&
        typeof attributes === 'object' &&
        (prototype === Object.prototype || prototype === null);
    } catch {
      validRoot = false;
    }
    if (!validRoot) state.truncated = true;
    else {
      try {
        visit(attributes, 0, state);
      } catch {
        state.truncated = true;
      }
    }
  }
  return {
    fieldNames: state.fieldNames,
    values: state.values,
    truncated: state.truncated,
  };
}
