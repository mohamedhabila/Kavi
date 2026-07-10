import type {
  IngestionJobStatus,
  IngestionOutcomeCode,
  IngestionProviderOutcome,
} from '../../services/memory/ingestionQueueStore';
import type { IngestionReceiptProviderOutcomeCode } from '../../services/memory/ingestionReceiptStore';

function completeEnum<All extends string>() {
  return <const Values extends readonly All[]>(
    values: Values & (Exclude<All, Values[number]> extends never ? unknown : never),
  ): Values => values;
}

export const E2E_PUBLIC_INGESTION_JOB_STATUSES = completeEnum<IngestionJobStatus>()([
  'pending',
  'processing',
  'retrying',
  'degraded',
  'completed_structural',
  'completed_enriched',
  'failed',
]);

export const E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES = completeEnum<IngestionProviderOutcome>()([
  'structural_only',
  'valid',
  'empty_valid',
  'malformed',
  'schema_invalid',
  'provider_error',
]);

export const E2E_PUBLIC_INGESTION_OUTCOME_CODES = completeEnum<IngestionOutcomeCode>()([
  'empty_response',
  'invalid_json',
  'non_object',
  'missing_required_field',
  'unexpected_field',
  'invalid_field_type',
  'invalid_field_value',
  'limit_exceeded',
  'provider_request_failed',
  'unsupported_response_shape',
  'processing_incomplete',
  'processing_error',
  'source_window_unavailable',
  'stale_processing_lease',
  'persona_scope_missing',
  'source_identity_invalid',
  'source_identity_conflict',
]);

export const E2E_PUBLIC_INGESTION_RECEIPT_OUTCOME_CODES =
  completeEnum<IngestionReceiptProviderOutcomeCode>()([
    'empty_response',
    'invalid_json',
    'non_object',
    'missing_required_field',
    'unexpected_field',
    'invalid_field_type',
    'invalid_field_value',
    'limit_exceeded',
    'provider_request_failed',
    'unsupported_response_shape',
  ]);
