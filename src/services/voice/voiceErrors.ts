export type VoiceOperationFailureKind =
  | 'permission_denied'
  | 'invalid_recording'
  | 'provider_unavailable'
  | 'transport'
  | 'provider_response'
  | 'unexpected';

export class VoiceOperationError extends Error {
  readonly kind: VoiceOperationFailureKind;
  readonly status?: number;

  constructor(
    kind: VoiceOperationFailureKind,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'VoiceOperationError';
    this.kind = kind;
    this.status = options?.status;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function getErrorMessageWithCauses(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  while (current) {
    const message = current instanceof Error ? current.message.trim() : String(current).trim();
    if (message && !messages.includes(message)) {
      messages.push(message);
    }

    if (typeof current === 'object' && current !== null && 'cause' in current) {
      current = (current as { cause?: unknown }).cause;
      continue;
    }

    break;
  }

  return messages.join(' -> ');
}
