// ---------------------------------------------------------------------------
// Kavi — Document (PDF) Input Capability & Size Limits
// ---------------------------------------------------------------------------
// Decides whether a PDF attachment can be sent to the active model as a
// provider-native document content block, and if so, whether it fits inside
// that provider's documented request-size ceiling. Both `media/service.ts`
// (best-effort text enrichment) and `orchestratorMessageFormatting.ts` (the
// actual outgoing content block) call `resolveDocumentInputDecision` so the
// two paths never disagree about what's supported.

import type { LlmProviderConfig } from '../../../types/provider';
import { resolveProviderTransport } from './providerProtocols';
import { supportsDocumentInput } from './providerCapabilities';

type DocumentCapableProvider = Pick<
  LlmProviderConfig,
  | 'kind'
  | 'local'
  | 'name'
  | 'baseUrl'
  | 'protocol'
  | 'providerFamily'
  | 'capabilityHints'
  | 'modelCapabilities'
>;

/**
 * Anthropic Messages API: 32 MB total request body, up to 600 pages (100 pages on
 * 200k-context models). https://docs.claude.com/en/docs/build-with-claude/pdf-support
 */
export const ANTHROPIC_DOCUMENT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * OpenAI Responses API `input_file`: each file must be under 50 MB, and the combined size of
 * every file in one request must also stay under 50 MB.
 * https://developers.openai.com/api/docs/guides/pdf-files
 */
export const OPENAI_RESPONSES_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Gemini API: PDFs up to 50 MB or 1000 pages, the same ceiling for inline `inline_data` and
 * Files API uploads. https://ai.google.dev/gemini-api/docs/document-processing
 */
export const GEMINI_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Base64 encodes every 3 raw bytes as 4 characters. Every limit above is documented as a
 * post-encoding request-body ceiling, but `Attachment.size` is the raw file size available
 * before the file is ever read — so a limit check against it has to translate the documented
 * limit back down first, rather than rounding a raw size up and comparing it to the encoded
 * ceiling directly.
 */
const BASE64_BYTE_EXPANSION_RATIO = 4 / 3;

/**
 * None of the three providers' page ceilings (Anthropic's 600/100, Gemini's 1000) are checked
 * here: verifying an actual page count needs a PDF parser, and this project deliberately has
 * no text-extraction/PDF-parsing dependency for document understanding (see the "no
 * text-extraction library" note on the PDF metadata stub this module replaces). Only the
 * documented byte ceiling — checkable from `Attachment.size` alone — is enforced.
 */
export type DocumentInputRefusalReason = 'unsupported_provider' | 'exceeds_size_limit';

export interface DocumentInputDecision {
  readonly supported: boolean;
  readonly refusalReason?: DocumentInputRefusalReason;
  /** The provider's documented (post-base64) byte limit; set whenever a limit applies. */
  readonly maxBytes?: number;
}

function resolveDocumentMaxBytes(provider: DocumentCapableProvider): number | undefined {
  switch (resolveProviderTransport(provider)) {
    case 'anthropic':
      return ANTHROPIC_DOCUMENT_MAX_BYTES;
    case 'gemini':
      return GEMINI_DOCUMENT_MAX_BYTES;
    case 'openai':
      return OPENAI_RESPONSES_DOCUMENT_MAX_BYTES;
    default:
      return undefined;
  }
}

/**
 * Decides whether `sizeBytes` (the attachment's raw, pre-base64 file size) can be sent to
 * `model` on `provider` as a provider-native document content block.
 */
export function resolveDocumentInputDecision(params: {
  provider: DocumentCapableProvider;
  model: string;
  sizeBytes: number;
}): DocumentInputDecision {
  if (!supportsDocumentInput(params.provider, params.model)) {
    return { supported: false, refusalReason: 'unsupported_provider' };
  }

  const maxBytes = resolveDocumentMaxBytes(params.provider);
  if (maxBytes === undefined) {
    // supportsDocumentInput() only returns true for a transport this function also resolves a
    // limit for; fail closed instead of embedding an unbounded payload if the two ever drift.
    return { supported: false, refusalReason: 'unsupported_provider' };
  }

  const maxRawBytes = Math.floor(maxBytes / BASE64_BYTE_EXPANSION_RATIO);
  if (Number.isFinite(params.sizeBytes) && params.sizeBytes > maxRawBytes) {
    return { supported: false, refusalReason: 'exceeds_size_limit', maxBytes };
  }

  return { supported: true, maxBytes };
}

/** Formats a documented byte limit for user-facing copy, e.g. `32 MB`. */
export function formatDocumentSizeLimitMB(maxBytes: number): string {
  const megabytes = maxBytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}
