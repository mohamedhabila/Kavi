import { recordFactWithContribution as recordProductionFactWithContribution } from '../../src/services/memory/facts/mutations';
import { replaceCurrentFactWithContribution as replaceProductionFactWithContribution } from '../../src/services/memory/facts/exactReplacement';
import type {
  MemoryFactSensitivity,
  SealedFactApplicabilityProvenance,
} from '../../src/services/memory/facts/applicabilityProvenance';
import type { MemoryFactContributionWriteContext } from '../../src/services/memory/factContributionStore';
import type {
  RecordFactInput,
  ReplaceCurrentFactInput,
} from '../../src/services/memory/facts/types';
import { codeOwnedMemorySensitivityDeclaration } from '../../src/services/memory/memorySensitivityPolicy';

/** Explicit code-owned producer boundary for tests unrelated to sensitivity classification. */
export function recordCodeOwnedTestFactWithContribution(
  input: RecordFactInput,
  applicability: SealedFactApplicabilityProvenance,
  context: MemoryFactContributionWriteContext,
  sensitivity: MemoryFactSensitivity = 'normal',
) {
  return recordProductionFactWithContribution(
    input,
    applicability,
    context,
    codeOwnedMemorySensitivityDeclaration(sensitivity),
  );
}

/** Explicit code-owned replacement producer boundary for tests unrelated to sensitivity. */
export function replaceCodeOwnedTestFactWithContribution(
  input: ReplaceCurrentFactInput,
  applicability: SealedFactApplicabilityProvenance,
  context: MemoryFactContributionWriteContext,
  sensitivity: MemoryFactSensitivity = 'normal',
) {
  return replaceProductionFactWithContribution(
    input,
    applicability,
    context,
    codeOwnedMemorySensitivityDeclaration(sensitivity),
  );
}
