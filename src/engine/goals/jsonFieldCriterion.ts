// ---------------------------------------------------------------------------
// Kavi — `evidence.json_field` criteria read against the results a goal holds
// ---------------------------------------------------------------------------
// A json_field criterion is the model's guess at the shape of a tool result it has
// usually not seen yet: goals are declared before the work runs. Measured on the full
// GLM 5.3 Flash suite (2026-10-10), 5 of the 9 json_field criteria the model wrote named
// a field no result carried — `recipients.length` for an SMS compose that returns
// `recipientCount`, `clipboard.text` for a clipboard read that returns `text` — and both
// runs that declared one first ended blocked with their work done. Once the results exist
// the code knows their real shape, so this module answers the questions the gate and its
// hints need: does any result carry the field at all, and which fields do they carry.
// ---------------------------------------------------------------------------

import { EFFECT_RECEIPT_EVIDENCE_PREFIX } from './effectCompletionEvidence';
import {
  extractJsonPayloadFromEvidenceEntry,
  readJsonFieldAtPath,
} from './structuralCriterionValues';

export const EVIDENCE_JSON_FIELD_PATTERN = /^evidence\.json_field:([^:]+):(.+)$/;

/** Most field paths a hint lists, so a large result cannot flood the prompt. */
const MAX_LISTED_FIELDS = 12;
/** How many levels a hint descends into nested results. */
const MAX_LISTED_FIELD_DEPTH = 3;
/** Longest result value quoted back in a hint. */
const MAX_QUOTED_VALUE_LENGTH = 80;

export type JsonFieldCriterion = Readonly<{ path: string; value: string }>;

export function readJsonFieldCriterion(criterion: string): JsonFieldCriterion | null {
  const match = criterion.trim().match(EVIDENCE_JSON_FIELD_PATTERN);
  if (!match) return null;
  const path = match[1].trim();
  const value = match[2].trim();
  return path && value ? { path, value } : null;
}

/** Every JSON payload the criterion is matched against, receipts included. */
function readJsonPayloads(evidence: ReadonlyArray<string>): unknown[] {
  return evidence
    .map(extractJsonPayloadFromEvidenceEntry)
    .filter((payload) => payload !== undefined);
}

/**
 * The JSON results tools returned. Code-owned effect receipts are left out: they describe
 * the effect, not the result, and naming their internals would invite criteria on them.
 */
function readToolResultPayloads(evidence: ReadonlyArray<string>): unknown[] {
  return readJsonPayloads(
    evidence.filter((entry) => !entry.startsWith(EFFECT_RECEIPT_EVIDENCE_PREFIX)),
  );
}

/**
 * True when the goal holds tool results and none of them carries the criterion's field.
 *
 * Such a criterion names a result shape the work does not have, rather than a deliverable
 * the work failed to produce, so no further work under it can ever meet it. A field that
 * is present with a different value is a real miss and is not this case, and neither is a
 * goal with no results yet, whose field may still arrive.
 */
export function isJsonFieldAbsentFromResults(
  criterion: string,
  evidence: ReadonlyArray<string>,
): boolean {
  const parsed = readJsonFieldCriterion(criterion);
  if (!parsed || readToolResultPayloads(evidence).length === 0) return false;
  return readJsonPayloads(evidence).every(
    (payload) => readJsonFieldAtPath(payload, parsed.path) === undefined,
  );
}

function collectFieldPaths(
  value: unknown,
  prefix: string,
  depth: number,
  into: Set<string>,
): void {
  if (into.size >= MAX_LISTED_FIELDS) return;
  if (Array.isArray(value)) {
    into.add(prefix ? `${prefix}.length` : 'length');
    if (value.length > 0 && depth < MAX_LISTED_FIELD_DEPTH) {
      collectFieldPaths(value[0], prefix ? `${prefix}.0` : '0', depth + 1, into);
    }
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (prefix) into.add(prefix);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (into.size >= MAX_LISTED_FIELDS) return;
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object' && depth < MAX_LISTED_FIELD_DEPTH) {
      collectFieldPaths(child, path, depth + 1, into);
    } else {
      into.add(path);
    }
  }
}

/** Field paths the goal's tool results carry, in the dotted form json_field reads. */
export function listToolResultFieldPaths(evidence: ReadonlyArray<string>): string[] {
  const fields = new Set<string>();
  for (const payload of readToolResultPayloads(evidence)) {
    collectFieldPaths(payload, '', 0, fields);
  }
  return Array.from(fields);
}

function quoteResultValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_QUOTED_VALUE_LENGTH
    ? `${text.slice(0, MAX_QUOTED_VALUE_LENGTH)}…`
    : text;
}

/**
 * The step that meets an unmet json_field criterion, judged against the results the goal
 * already holds. The criterion reads tool results, so the step is never a file write —
 * telling the model to write one sent two traced runs into fabricating JSON files that
 * could not satisfy the criterion either.
 */
export function describeJsonFieldCriterionAction(
  criterion: JsonFieldCriterion,
  evidence: ReadonlyArray<string>,
): string {
  const { path, value } = criterion;
  if (readToolResultPayloads(evidence).length === 0) {
    return `call the tool whose JSON result has ${path} equal to ${value}`;
  }
  for (const payload of readJsonPayloads(evidence)) {
    const actual = readJsonFieldAtPath(payload, path);
    if (actual !== undefined) {
      return `the results this goal holds have ${path} = ${quoteResultValue(actual)}, not ${value}; produce a result where ${path} is ${value}`;
    }
  }
  const fields = listToolResultFieldPaths(evidence);
  return (
    `no result this goal holds has a field ${path}` +
    (fields.length > 0 ? ` — they carry ${fields.join(', ')}` : '') +
    '. If one of those is what this criterion meant, send update_goals action "update" ' +
    'with successCriteria where this criterion is replaced by one naming that field'
  );
}
