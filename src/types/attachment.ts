import type { DocumentInputRefusalReason } from '../services/llm/catalog/documentCapabilities';

export interface Attachment {
  id: string;
  type: 'image' | 'file' | 'audio';
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  base64?: string;
  workspacePath?: string;
  durationMs?: number;
  transcript?: string;
  waveformLevels?: number[];
  /**
   * Set only when this attachment is a PDF the active provider/model couldn't accept as a
   * provider-native document content block at the time the message enclosing it was sent —
   * computed once by `resolveDocumentInputDecision` (see `services/media/service.ts`) and
   * persisted structurally so the UI can render a notice without inferring anything from
   * message text.
   */
  documentInputRefusalReason?: DocumentInputRefusalReason;
  /** The provider's documented byte ceiling that was exceeded; set only alongside `'exceeds_size_limit'`. */
  documentInputRefusalMaxBytes?: number;
}
