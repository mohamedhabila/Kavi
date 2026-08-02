type ToolCallKeyRecord = Readonly<{
  name: string;
  arguments: string;
}>;

type ToolResultKeyRecord = Readonly<{
  result?: string;
  resultHash?: string;
}>;

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

export function simpleLoopDetectionHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return hash.toString(36);
}

export function normalizeToolNameKey(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function buildRawToolArgsKey(entry: ToolCallKeyRecord): string {
  return `${normalizeToolNameKey(entry.name)}::${entry.arguments}`;
}

export function buildRawToolResultKey(entry: ToolResultKeyRecord): string | undefined {
  return entry.resultHash ?? hashResult(entry.result);
}

export function hashToolCall(toolName: string, params: unknown): string {
  try {
    return `${toolName}:${simpleLoopDetectionHash(stableStringify(params))}`;
  } catch {
    return `${toolName}:${simpleLoopDetectionHash(String(params))}`;
  }
}

export function hashResult(result: string | undefined): string | undefined {
  return result === undefined ? undefined : simpleLoopDetectionHash(result);
}
