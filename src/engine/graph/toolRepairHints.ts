import type { ToolCallRecord } from '../loopDetection';

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonRecord(text: string | undefined): JsonRecord | undefined {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}

function readRepairRecord(result: string | undefined): JsonRecord | undefined {
  const parsed = parseJsonRecord(result);
  return isJsonRecord(parsed?.repair) ? parsed.repair : undefined;
}

function readRepairFields(repair: JsonRecord): string[] {
  const missingFields = readStringArray(repair.missingFields);
  if (missingFields.length > 0) {
    return missingFields;
  }

  const invalidFields = readStringArray(repair.invalidFields);
  if (invalidFields.length > 0) {
    return invalidFields;
  }

  return readStringArray(repair.fields);
}

export function extractRecentToolRepairHints(
  history: ReadonlyArray<ToolCallRecord> | undefined,
  limit: number = 3,
): string[] {
  const hints: string[] = [];
  const entries = history ?? [];

  for (let index = entries.length - 1; index >= 0 && hints.length < limit; index -= 1) {
    const entry = entries[index];
    const repair = readRepairRecord(entry.result);
    if (!repair || repair.retryable !== true || typeof repair.code !== 'string') {
      continue;
    }

    const fields = readRepairFields(repair);
    const fieldSuffix = fields.length > 0 ? ` fields ${fields.join(', ')}` : '';
    const hint = `${entry.name}: ${repair.code}${fieldSuffix}`;
    if (!hints.includes(hint)) {
      hints.push(hint);
    }
  }

  return hints;
}
