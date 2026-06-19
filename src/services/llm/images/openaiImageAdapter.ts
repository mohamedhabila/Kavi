import { normalizeUsage } from '../../usage/tracker';
import { PRIMARY_OPENAI_IMAGE_MODEL, isOpenAIImageModel, normalizeImageModelId } from './modelPolicy';
import type { GeneratedImagePayload, ImageEditRequest, ImageEditPayloadSource, ImageGenerationRequest } from './types';

export async function generateOpenAICompatibleImage(args: {
  baseUrl: string;
  headers: Record<string, string>;
  defaultModel?: string;
  options: ImageGenerationRequest;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<GeneratedImagePayload> {
  const model =
    normalizeImageModelId(args.options.model || args.defaultModel || PRIMARY_OPENAI_IMAGE_MODEL) ||
    PRIMARY_OPENAI_IMAGE_MODEL;
  const body: Record<string, any> = {
    prompt: args.options.prompt,
    model,
    n: 1,
  };

  if (args.options.size) body.size = args.options.size;
  if (args.options.quality) body.quality = args.options.quality;
  if (args.options.style && /^dall-e-3$/i.test(model)) body.style = args.options.style;

  if (isOpenAIImageModel(model)) {
    body.output_format = args.options.format || 'png';
    if (args.options.background) body.background = args.options.background;
  } else {
    body.response_format = 'b64_json';
  }

  const response = await args.performFetch(`${args.baseUrl}/images/generations`, {
    method: 'POST',
    headers: args.headers,
    body: JSON.stringify(body),
    signal: args.options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Image generation error ${response.status}: ${errorText}`);
  }

  const json = (await response.json()) as any;
  const first = json?.data?.[0];
  if (!first) {
    throw new Error('Image generation returned no results');
  }

  return {
    model,
    b64_json: first.b64_json,
    url: first.url,
    revisedPrompt: first.revised_prompt,
    outputFormat: json.output_format || body.output_format || args.options.format || 'png',
    usage: normalizeGeneratedImageUsage(json?.usage, model),
  };
}

export async function editOpenAICompatibleImage(args: {
  baseUrl: string;
  headers: Record<string, string>;
  defaultModel?: string;
  options: ImageEditRequest;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<GeneratedImagePayload> {
  const model =
    normalizeImageModelId(args.options.model || args.defaultModel || PRIMARY_OPENAI_IMAGE_MODEL) ||
    PRIMARY_OPENAI_IMAGE_MODEL;
  const formData = new FormData();

  formData.append('model', model);
  formData.append('prompt', args.options.prompt);
  formData.append('n', '1');
  if (args.options.size) formData.append('size', args.options.size);
  if (args.options.quality) formData.append('quality', args.options.quality);
  if (isOpenAIImageModel(model)) {
    if (args.options.format) formData.append('output_format', args.options.format);
    if (args.options.background) formData.append('background', args.options.background);
    if (args.options.inputFidelity) formData.append('input_fidelity', args.options.inputFidelity);
    if (args.options.moderation) formData.append('moderation', args.options.moderation);
    if (typeof args.options.outputCompression === 'number') {
      formData.append('output_compression', String(Math.round(args.options.outputCompression)));
    }
  } else {
    formData.append('response_format', 'b64_json');
  }

  const imageFieldName = args.options.images.length > 1 ? 'image[]' : 'image';
  for (const image of args.options.images) {
    appendMultipartImageSource(formData, imageFieldName, image);
  }
  if (args.options.mask) {
    appendMultipartImageSource(formData, 'mask', args.options.mask);
  }

  const requestHeaders = { ...args.headers };
  delete requestHeaders['Content-Type'];

  const response = await args.performFetch(`${args.baseUrl}/images/edits`, {
    method: 'POST',
    headers: requestHeaders,
    body: formData,
    signal: args.options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Image edit error ${response.status}: ${errorText}`);
  }

  const json = (await response.json()) as any;
  const first = json?.data?.[0];
  if (!first) {
    throw new Error('Image editing returned no results');
  }

  return {
    model,
    b64_json: first.b64_json,
    url: first.url,
    revisedPrompt: first.revised_prompt,
    outputFormat: json.output_format || args.options.format || 'png',
    usage: normalizeGeneratedImageUsage(json?.usage, model),
  };
}

function appendMultipartImageSource(
  formData: FormData,
  fieldName: string,
  source: ImageEditPayloadSource,
): void {
  formData.append(fieldName, {
    uri: source.uri,
    name: source.name || 'image.png',
    type: source.mimeType || 'image/png',
  } as any);
}

function normalizeGeneratedImageUsage(usage: unknown, model: string) {
  const normalizedUsage = normalizeUsage(usage);
  if (!normalizedUsage) {
    return undefined;
  }

  return {
    ...normalizedUsage,
    model,
  };
}
