import {
  REQUEST_FRAME_VERSION,
  type RequestContinuation,
  type RequestFrame,
  type RequestInputKind,
  type RequestMode,
} from '../../services/agents/requestFrame';

const PUNCTUATION_ONLY_PATTERN = /^[\s.\-_,!?/\\|+=*~:;()[\]{}<>…"'`“”‘’]+$/u;
export function normalizeRequestText(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function requestTextIsPunctuationOnly(value: string): boolean {
  return PUNCTUATION_ONLY_PATTERN.test(value);
}

function requestInputKind(textPresent: boolean, attachmentCount: number): RequestInputKind {
  if (textPresent && attachmentCount > 0) return 'text_and_attachments';
  if (textPresent) return 'text';
  if (attachmentCount > 0) return 'attachments';
  return 'empty';
}

export function buildGraphEntryRequestFrame(params: {
  text: string | undefined;
  attachmentCount: number;
  mode: RequestMode;
  continuation: RequestContinuation;
}): RequestFrame {
  const normalized = normalizeRequestText(params.text);
  if (!Number.isSafeInteger(params.attachmentCount) || params.attachmentCount < 0) {
    throw new Error('request_frame_attachment_count_invalid');
  }
  const kind = requestInputKind(normalized.length > 0, params.attachmentCount);
  const decision =
    kind === 'empty'
      ? ({ action: 'clarify', reason: 'missing_input' } as const)
      : params.attachmentCount === 0 && requestTextIsPunctuationOnly(normalized)
        ? ({ action: 'clarify', reason: 'punctuation_only' } as const)
        : ({ action: 'act', reason: 'actionable_input' } as const);
  return {
    version: REQUEST_FRAME_VERSION,
    mode: params.mode,
    input: {
      kind,
      attachmentCount: params.attachmentCount,
    },
    continuation: params.continuation,
    requiredInformation: [],
    decision,
  };
}
