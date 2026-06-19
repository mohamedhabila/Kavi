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
}
