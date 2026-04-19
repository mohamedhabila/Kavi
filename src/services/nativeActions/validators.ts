import { NativeActionError } from './types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export const SAFE_OPEN_URL_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'tel',
  'sms',
  'smsto',
  'geo',
]);

export function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new NativeActionError('invalid_arguments', `${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new NativeActionError('invalid_arguments', `${fieldName} cannot be empty.`);
  }

  return trimmed;
}

export function normalizeOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizeRequiredString(value, fieldName);
}

export function normalizeOptionalStringArray(
  value: unknown,
  fieldName: string,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new NativeActionError('invalid_arguments', `${fieldName} must be an array of strings.`);
  }

  return value.map((entry, index) => normalizeRequiredString(entry, `${fieldName}[${index}]`));
}

export function normalizeFiniteNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NativeActionError('invalid_arguments', `${fieldName} must be a finite number.`);
  }

  return value;
}

export function normalizeLimit(value: unknown, defaultValue = 10, maxValue = 25): number {
  const numeric = normalizeFiniteNumber(value, 'limit');
  if (numeric === undefined) {
    return defaultValue;
  }
  return Math.max(1, Math.min(maxValue, Math.floor(numeric)));
}

export function validateEmailAddresses(addresses: string[], fieldName: string): string[] {
  return addresses.map((address, index) => {
    const normalized = normalizeRequiredString(address, `${fieldName}[${index}]`);
    if (!EMAIL_REGEX.test(normalized)) {
      throw new NativeActionError(
        'invalid_email',
        `${fieldName}[${index}] is not a valid email address.`,
      );
    }
    return normalized;
  });
}

export function validateFileUri(
  uri: string,
  fieldName: string,
  options?: { allowContentUri?: boolean },
): string {
  const normalized = normalizeRequiredString(uri, fieldName);
  const allowContentUri = options?.allowContentUri === true;
  if (normalized.startsWith('file://')) {
    return normalized;
  }
  if (allowContentUri && normalized.startsWith('content://')) {
    return normalized;
  }

  const supportedSchemes = allowContentUri ? '`file://` or `content://`' : '`file://`';
  throw new NativeActionError(
    'invalid_file_uri',
    `${fieldName} must be a local ${supportedSchemes} URI.`,
  );
}

export function normalizeUrlWithAllowlist(
  rawUrl: unknown,
  allowedSchemes: Set<string> = SAFE_OPEN_URL_SCHEMES,
): { url: string; scheme: string } {
  const normalized = normalizeRequiredString(rawUrl, 'url');
  const match = normalized.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) {
    throw new NativeActionError('invalid_url', 'url must include a supported URI scheme.');
  }

  const scheme = match[1].toLowerCase();
  if (!allowedSchemes.has(scheme)) {
    throw new NativeActionError(
      'disallowed_url_scheme',
      `URL scheme "${scheme}" is not allowed for this action.`,
      'failed',
      { scheme },
    );
  }

  return { url: normalized, scheme };
}
