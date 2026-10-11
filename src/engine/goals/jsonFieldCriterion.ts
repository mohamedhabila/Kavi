// ---------------------------------------------------------------------------
// Kavi — `evidence.json_field` criteria read against the results a goal holds
// ---------------------------------------------------------------------------
// A json_field criterion is the model's guess at the shape of a tool result it has
// usually not seen yet: goals are declared before the work runs. Measured on the full
// GLM 5.3 Flash suite (2026-10-10), 5 of the 9 json_field criteria the model wrote named
// a field no result carried — `recipients.length` for an SMS compose that returns
// `recipientCount`, `clipboard.text` for a clipboard read that returns `text` — and both
// runs that declared one first ended blocked with their work done. Once the results exist
// the code knows their real shape, so this module answers whether any result carries the
// field at all.
// ---------------------------------------------------------------------------

import { EFFECT_RECEIPT_EVIDENCE_PREFIX } from './effectCompletionEvidence';
import {
  extractJsonPayloadFromEvidenceEntry,
  readJsonFieldAtPath,
} from './structuralCriterionValues';

export const EVIDENCE_JSON_FIELD_PATTERN = /^evidence\.json_field:([^:]+):(.+)$/;

export type JsonFieldCriterion = Readonly<{ path: string; value: string }>;

function readJsonFieldCriterion(criterion: string): JsonFieldCriterion | null {
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
