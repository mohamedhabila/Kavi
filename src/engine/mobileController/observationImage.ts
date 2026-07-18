import type { Attachment } from '../../types/attachment';

const MAX_OBSERVATION_IMAGE_BYTES = 8_000_000;
const MAX_BASE64_LENGTH = 12_000_000;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : null;
}

/** Validate and privacy-bound one ephemeral controller observation image. */
export function qualifyMobileControllerObservationImage(value: unknown): Attachment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<Attachment>;
  const id = boundedText(candidate.id, 200);
  const uri = boundedText(candidate.uri, 4_096);
  const name = boundedText(candidate.name, 512);
  const mimeType = boundedText(candidate.mimeType, 100)?.toLowerCase() ?? null;
  const base64 =
    candidate.base64 === undefined
      ? undefined
      : boundedText(candidate.base64, MAX_BASE64_LENGTH) ?? null;
  if (
    candidate.type !== 'image' ||
    !id ||
    !uri ||
    !name ||
    !mimeType ||
    !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) ||
    !Number.isSafeInteger(candidate.size) ||
    Number(candidate.size) <= 0 ||
    Number(candidate.size) > MAX_OBSERVATION_IMAGE_BYTES ||
    base64 === null
  ) {
    return null;
  }
  return {
    id,
    type: 'image',
    uri,
    name,
    mimeType,
    size: Number(candidate.size),
    ...(base64 ? { base64 } : {}),
  };
}
