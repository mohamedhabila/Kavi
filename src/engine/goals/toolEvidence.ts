const MAX_TOOL_EVIDENCE_EXCERPT_CHARS = 200;
const MAX_SCALAR_PATH_EVIDENCE_STRINGS = 32;
const MAX_SCALAR_PATH_EVIDENCE_DEPTH = 5;
const MAX_SCALAR_PATH_STRING_CHARS = 160;

function truncateExcerpt(content: string): string {
  if (content.length <= MAX_TOOL_EVIDENCE_EXCERPT_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_TOOL_EVIDENCE_EXCERPT_CHARS)}…`;
}

function buildPythonGoalEvidenceStrings(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return [`python:${truncateExcerpt(content)}`];
    }

    const record = parsed as Record<string, unknown>;
    const strings: string[] = [];
    const status = record.status === 'completed' ? 'success' : 'result';
    strings.push(`python:execution:${status}`);

    const exitCode = record.exitCode ?? record.exit_code;
    if (typeof exitCode === 'number' && Number.isInteger(exitCode)) {
      strings.push(`python:exit_code:${exitCode}`);
    }

    const files = record.files;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (!file || typeof file !== 'object') {
          continue;
        }
        const path = (file as Record<string, unknown>).path;
        if (typeof path === 'string' && path.trim().length > 0) {
          strings.push(`python:artifact:${path.trim()}`);
        }
      }
    }

    return strings.length > 0 ? strings : [`python:${truncateExcerpt(content)}`];
  } catch {
    return [`python:${truncateExcerpt(content)}`];
  }
}

function buildCompactJsonObjectEvidenceString(toolName: string, content: string): string | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return null;
    }

    const compact: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        compact[key] = value;
      }
    }

    return Object.keys(compact).length > 0 ? `${toolName}:${JSON.stringify(compact)}` : null;
  } catch {
    return null;
  }
}

function buildCompactJsonArrayEvidenceString(toolName: string, content: string): string | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    return `${toolName}:${JSON.stringify({ length: parsed.length })}`;
  } catch {
    return null;
  }
}

function isScalarEvidenceValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function normalizeScalarEvidenceValue(value: string | number | boolean): string | number | boolean {
  if (typeof value !== 'string') {
    return value;
  }
  return value.length > MAX_SCALAR_PATH_STRING_CHARS
    ? `${value.slice(0, MAX_SCALAR_PATH_STRING_CHARS)}…`
    : value;
}

function assignNestedScalarPath(
  target: Record<string, unknown> | unknown[],
  path: ReadonlyArray<string>,
  value: string | number | boolean,
): void {
  let current: Record<string, unknown> | unknown[] = target;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const isLeaf = index === path.length - 1;
    const nextSegment = path[index + 1];
    const nextContainer: Record<string, unknown> | unknown[] =
      nextSegment !== undefined && /^\d+$/.test(nextSegment) ? [] : {};

    if (Array.isArray(current)) {
      const numericIndex = Number(segment);
      if (!Number.isInteger(numericIndex) || numericIndex < 0) {
        return;
      }
      if (isLeaf) {
        current[numericIndex] = value;
        return;
      }
      const existing = current[numericIndex];
      if (!existing || typeof existing !== 'object') {
        current[numericIndex] = nextContainer;
      }
      current = current[numericIndex] as Record<string, unknown> | unknown[];
      continue;
    }

    if (isLeaf) {
      current[segment] = value;
      return;
    }
    const existing = current[segment];
    if (!existing || typeof existing !== 'object') {
      current[segment] = nextContainer;
    }
    current = current[segment] as Record<string, unknown> | unknown[];
  }
}

function buildScalarPathEvidenceString(
  toolName: string,
  path: ReadonlyArray<string>,
  value: string | number | boolean,
): string | null {
  if (path.length === 0) {
    return null;
  }
  const root: Record<string, unknown> | unknown[] = /^\d+$/.test(path[0]) ? [] : {};
  assignNestedScalarPath(root, path, normalizeScalarEvidenceValue(value));
  return `${toolName}:${JSON.stringify(root)}`;
}

function collectScalarPathEvidenceStrings(
  toolName: string,
  value: unknown,
  path: string[],
  output: string[],
): void {
  if (output.length >= MAX_SCALAR_PATH_EVIDENCE_STRINGS) {
    return;
  }

  if (isScalarEvidenceValue(value)) {
    const evidence = buildScalarPathEvidenceString(toolName, path, value);
    if (evidence) {
      output.push(evidence);
    }
    return;
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    path.length >= MAX_SCALAR_PATH_EVIDENCE_DEPTH
  ) {
    return;
  }

  if (Array.isArray(value)) {
    const lengthEvidence = buildScalarPathEvidenceString(toolName, [...path, 'length'], value.length);
    if (lengthEvidence) {
      output.push(lengthEvidence);
    }
    for (let index = 0; index < Math.min(value.length, 5); index += 1) {
      collectScalarPathEvidenceStrings(toolName, value[index], [...path, String(index)], output);
      if (output.length >= MAX_SCALAR_PATH_EVIDENCE_STRINGS) {
        return;
      }
    }
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    collectScalarPathEvidenceStrings(toolName, childValue, [...path, key], output);
    if (output.length >= MAX_SCALAR_PATH_EVIDENCE_STRINGS) {
      return;
    }
  }
}

function buildScalarPathEvidenceStrings(toolName: string, content: string): string[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    const evidence: string[] = [];
    collectScalarPathEvidenceStrings(toolName, parsed, [], evidence);
    return evidence;
  } catch {
    return [];
  }
}

function normalizeSha256Digest(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/^sha256:/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function buildFileHashEvidenceString(toolName: string, content: string): string | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    if (!path) {
      return null;
    }

    const digest =
      normalizeSha256Digest(record.sha256) ||
      normalizeSha256Digest(record.digest) ||
      normalizeSha256Digest(record.hash);
    if (!digest) {
      return null;
    }

    return `${toolName}:file_hash:${path}:sha256:${digest}`;
  } catch {
    return null;
  }
}

export function buildToolGoalEvidenceStrings(params: {
  toolName: string;
  content: string;
}): string[] {
  if (params.toolName === 'python') {
    return buildPythonGoalEvidenceStrings(params.content);
  }

  return Array.from(
    new Set(
      [
        `${params.toolName}:${truncateExcerpt(params.content)}`,
        buildFileHashEvidenceString(params.toolName, params.content),
        buildCompactJsonArrayEvidenceString(params.toolName, params.content),
        buildCompactJsonObjectEvidenceString(params.toolName, params.content),
        ...buildScalarPathEvidenceStrings(params.toolName, params.content),
      ].filter((entry): entry is string => Boolean(entry)),
    ),
  );
}
