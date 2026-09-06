import {
  executeNativeAction,
  serializeNativeActionResult,
} from '../../../services/nativeActions/actionService';
import type { NativeActionResult } from '../../../services/nativeActions/types';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../types/toolRuntimeOutcome';
import type { ToolCallFailureKind } from '../../../types/message';

/**
 * Maps the native action layer's own finite error codes (see
 * `RECOVERABLE_PLATFORM_ERRORS` / `RECOVERABLE_EXTERNAL_ERRORS` in
 * `engine/tools/native/shared.ts`, the argument validators in
 * `services/nativeActions/validators.ts`, `resolveLocalFile` in
 * `services/nativeActions/files.ts`, and the fallback codes in
 * `services/nativeActions/types.ts`) onto the closed tool-failure taxonomy.
 * This is a structural switch on a code the native bridge itself returns,
 * never a match against the human-readable summary text.
 */
function classifyNativeActionFailureKind(code: string | undefined): ToolCallFailureKind {
  switch (code) {
    case 'permission_denied':
    case 'permission_blocked':
      return 'permission';
    case 'platform_unavailable':
    case 'external_app_unavailable':
    case 'contacts_unavailable':
      return 'unavailable';
    case 'user_cancelled':
      return 'aborted';
    // Argument validators (validators.ts, builders/*.ts, adapters/*.ts) throw one of
    // these finite codes for a caller-supplied value that fails a structural check.
    case 'validation_error':
    case 'invalid_arguments':
    case 'invalid_url':
    case 'invalid_email':
    case 'invalid_email_request':
    case 'invalid_sms_attachment_uri':
    case 'invalid_country_code':
    case 'invalid_maps_request':
    case 'invalid_mime_type':
    case 'invalid_file_uri':
    case 'invalid_phone_number':
    case 'disallowed_url_scheme':
      return 'invalid_arguments';
    // A caller-referenced local resource does not exist (resolveLocalFile).
    case 'file_not_found':
    case 'unknown_native_action':
      return 'not_found';
    case 'transient_native_error':
      return 'internal';
    // errorToNativeActionResult's fallback for a non-NativeActionError throw —
    // an unexpected failure inside the native bridge, not a classified one.
    case 'native_action_failed':
      return 'internal';
    default:
      return 'unknown';
  }
}

export async function executeStructuredNativeAction(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolRuntimeOutcome> {
  const result: NativeActionResult<Record<string, unknown>> = await executeNativeAction(
    name,
    args,
  );
  const content = serializeNativeActionResult(result);
  return result.executionStatus === 'completed'
    ? completedToolOutcome(content)
    : failedToolOutcome(content, classifyNativeActionFailureKind(result.code));
}
