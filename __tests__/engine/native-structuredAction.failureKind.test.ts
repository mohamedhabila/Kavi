// ---------------------------------------------------------------------------
// Tests — executeStructuredNativeAction failureKind classification
// ---------------------------------------------------------------------------
// classifyNativeActionFailureKind maps the native action layer's own finite
// error codes onto the closed ToolCallFailureKind taxonomy. These tests prove
// the classification comes from the structural `code` the native bridge
// returns, never from matching the human-readable summary text.

import { executeStructuredNativeAction } from '../../src/engine/tools/native/structuredAction';
import { parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';

function failureKindOf(outcome: { failureKind?: string }): string | undefined {
  return outcome.failureKind;
}

describe('executeStructuredNativeAction failureKind classification', () => {
  it('classifies an unrecognized action name as not_found', async () => {
    const outcome = await executeStructuredNativeAction('totally_unrecognized_action', {});
    const parsed = parseFailedToolOutcome(outcome);

    expect(parsed.code).toBe('unknown_native_action');
    expect(failureKindOf(outcome)).toBe('not_found');
  });

  it('classifies an invalid open_url scheme as invalid_arguments', async () => {
    const outcome = await executeStructuredNativeAction('open_url', {
      url: 'ftp://example.com/archive',
    });
    const parsed = parseFailedToolOutcome(outcome);

    expect(parsed.code).toBe('disallowed_url_scheme');
    expect(failureKindOf(outcome)).toBe('invalid_arguments');
  });

  it('classifies a missing url argument as invalid_arguments', async () => {
    const outcome = await executeStructuredNativeAction('open_url', {});
    const parsed = parseFailedToolOutcome(outcome);

    expect(typeof parsed.code).toBe('string');
    expect(failureKindOf(outcome)).toBe('invalid_arguments');
  });

  it('classifies an invalid phone number as invalid_arguments', async () => {
    const outcome = await executeStructuredNativeAction('phone_call', { number: '' });
    const parsed = parseFailedToolOutcome(outcome);

    expect(typeof parsed.code).toBe('string');
    expect(failureKindOf(outcome)).toBe('invalid_arguments');
  });

  it('classifies a maps_open request missing both query and coordinates as invalid_arguments', async () => {
    const outcome = await executeStructuredNativeAction('maps_open', {});
    const parsed = parseFailedToolOutcome(outcome);

    expect(parsed.code).toBe('invalid_maps_request');
    expect(failureKindOf(outcome)).toBe('invalid_arguments');
  });
});
