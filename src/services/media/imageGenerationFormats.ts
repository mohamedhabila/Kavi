export type GeneratedImageFormat = 'png' | 'jpeg' | 'webp';

export function guessMimeType(format?: string): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}

export function getFileExtension(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.split(/[?#]/, 1)[0] || value;
  const match = normalized.toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match?.[1] || undefined;
}

export function normalizeImageFormat(value?: string | null): GeneratedImageFormat | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
    case 'webp':
      return normalized;
    default:
      return undefined;
  }
}

export function inferImageFormatFromMimeType(
  value?: string | null,
): GeneratedImageFormat | undefined {
  const normalized = value?.split(';')[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return undefined;
  }
}

export function inferImageFormatFromUrl(value?: string | null): GeneratedImageFormat | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return normalizeImageFormat(new URL(value).pathname.split('.').pop() || '');
  } catch {
    const withoutQuery = value.split(/[?#]/, 1)[0] || value;
    return normalizeImageFormat(withoutQuery.split('.').pop() || '');
  }
}

export function inferOutputFormat(options: {
  requestedFormat?: string;
  outputFormat?: string;
  mimeType?: string | null;
  sourceUrl?: string;
}): GeneratedImageFormat {
  return (
    normalizeImageFormat(options.outputFormat) ||
    inferImageFormatFromMimeType(options.mimeType) ||
    normalizeImageFormat(options.requestedFormat) ||
    inferImageFormatFromUrl(options.sourceUrl) ||
    'png'
  );
}
