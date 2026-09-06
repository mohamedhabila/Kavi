// ---------------------------------------------------------------------------
// Kavi — Media Understanding Types
//
// ---------------------------------------------------------------------------

import type { DocumentInputRefusalReason } from '../llm/catalog/documentCapabilities';

export type MediaUnderstandingKind =
  | 'image.description'
  | 'audio.transcription'
  | 'document.extraction';

export interface MediaUnderstandingOutput {
  kind: MediaUnderstandingKind;
  attachmentIndex: number;
  text: string;
  provider?: string;
  model?: string;
  error?: string;
  /**
   * Set only for a `document.extraction` output produced because the active provider/model
   * couldn't take the document as a provider-native content block — never inferred from
   * `text`, so a UI surfacing this notice can branch on the reason structurally instead of
   * matching the (localized) message text.
   */
  documentInputRefusalReason?: DocumentInputRefusalReason;
  /** The provider's documented byte ceiling that was exceeded; set only alongside `'exceeds_size_limit'`. */
  documentInputRefusalMaxBytes?: number;
}
