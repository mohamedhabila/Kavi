import type { RequestAssessment } from '../../services/agents/requestGovernance';

const PUNCTUATION_ONLY_PATTERN = /^[\s.\-_,!?/\\|+=*~:;()[\]{}<>…"'`“”‘’]+$/u;
export function normalizeRequestText(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function requestTextIsPunctuationOnly(value: string): boolean {
  return PUNCTUATION_ONLY_PATTERN.test(value);
}

export function assessGraphEntryRequest(params: {
  text: string | undefined;
  hasAttachments?: boolean;
}): RequestAssessment {
  const normalized = normalizeRequestText(params.text);
  if (!normalized) {
    return { action: 'clarify' };
  }
  if (!params.hasAttachments && requestTextIsPunctuationOnly(normalized)) {
    return { action: 'clarify' };
  }
  return { action: 'proceed' };
}
