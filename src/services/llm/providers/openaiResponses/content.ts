import { normalizeMessageContent } from '../../core/content';
import { isPlainRecord } from '../../core/json';

export function toOpenAIResponsesMessageContent(value: unknown): string | any[] {
  const normalized = normalizeMessageContent(value);

  if (typeof normalized === 'string') {
    return normalized;
  }

  if (!Array.isArray(normalized)) {
    if (normalized == null) {
      return '';
    }
    return String(normalized);
  }

  const parts = normalized.flatMap((entry): any[] => {
    if (typeof entry === 'string') {
      return entry.length > 0 ? [{ type: 'input_text', text: entry }] : [];
    }

    if (!isPlainRecord(entry)) {
      const text = entry == null ? '' : String(entry);
      return text.length > 0 ? [{ type: 'input_text', text }] : [];
    }

    if (entry.type === 'input_text' && typeof entry.text === 'string') {
      return entry.text.length > 0 ? [{ ...entry }] : [];
    }

    if (entry.type === 'text' && typeof entry.text === 'string') {
      return entry.text.length > 0 ? [{ type: 'input_text', text: entry.text }] : [];
    }

    if (entry.type === 'input_image') {
      const imageUrl = typeof entry.image_url === 'string' ? entry.image_url : undefined;
      const fileId = typeof entry.file_id === 'string' ? entry.file_id : undefined;
      if (!imageUrl && !fileId) {
        return [];
      }
      return [
        {
          type: 'input_image',
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(fileId ? { file_id: fileId } : {}),
          ...(typeof entry.detail === 'string' ? { detail: entry.detail } : {}),
        },
      ];
    }

    if (entry.type === 'image_url') {
      const imageUrl = isPlainRecord(entry.image_url) ? entry.image_url.url : entry.image_url;
      const detail = isPlainRecord(entry.image_url) ? entry.image_url.detail : undefined;
      if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
        return [];
      }
      return [
        {
          type: 'input_image',
          image_url: imageUrl,
          ...(typeof detail === 'string' ? { detail } : {}),
        },
      ];
    }

    if (entry.type === 'input_file' || entry.type === 'file') {
      const fileId = typeof entry.file_id === 'string' ? entry.file_id : undefined;
      const fileData = typeof entry.file_data === 'string' ? entry.file_data : undefined;
      const filename = typeof entry.filename === 'string' ? entry.filename : undefined;
      if (!fileId && !fileData) {
        return [];
      }
      return [
        {
          type: 'input_file',
          ...(fileId ? { file_id: fileId } : {}),
          ...(fileData ? { file_data: fileData } : {}),
          ...(filename ? { filename } : {}),
        },
      ];
    }

    try {
      return [{ type: 'input_text', text: JSON.stringify(entry) }];
    } catch {
      return [{ type: 'input_text', text: String(entry) }];
    }
  });

  if (parts.length === 0) {
    return '';
  }

  if (parts.length === 1 && parts[0].type === 'input_text') {
    return parts[0].text;
  }

  return parts;
}

export function toOpenAIResponsesText(value: unknown): string {
  const content = toOpenAIResponsesMessageContent(value);
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      if (!isPlainRecord(part)) {
        return String(part ?? '');
      }
      if (part.type === 'input_text' && typeof part.text === 'string') {
        return part.text;
      }
      if (part.type === 'input_image') {
        return '[image]';
      }
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
    .join('\n');
}
