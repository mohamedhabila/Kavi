import type { TokenUsage } from '../../../types/usage';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface ImageEditPayloadSource {
  uri: string;
  name?: string;
  mimeType?: string;
  dataUri?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  format?: ImageOutputFormat;
  background?: 'transparent' | 'opaque' | 'auto';
  style?: 'vivid' | 'natural';
  signal?: AbortSignal;
}

export interface ImageEditRequest extends ImageGenerationRequest {
  images: ImageEditPayloadSource[];
  mask?: ImageEditPayloadSource;
  inputFidelity?: 'high' | 'low';
  moderation?: 'auto' | 'low';
  outputCompression?: number;
}

export interface GeneratedImagePayload {
  model: string;
  b64_json?: string;
  url?: string;
  revisedPrompt?: string;
  outputFormat: ImageOutputFormat;
  usage?: TokenUsage;
}
