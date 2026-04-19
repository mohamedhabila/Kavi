// ---------------------------------------------------------------------------
// Kavi — Media Understanding Types
//
// ---------------------------------------------------------------------------

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
}
