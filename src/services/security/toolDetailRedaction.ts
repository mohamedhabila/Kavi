const REDACTION_MARKER = '[REDACTED]';
const DEFAULT_MAX_DETAIL_CHARACTERS = 4_000;

export interface RedactedToolDetail {
  text: string;
  truncated: boolean;
}

const SENSITIVE_KEYS = new Set([
  'apikey',
  'apisecret',
  'accesstoken',
  'authorization',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'connectionstring',
  'cookie',
  'credentials',
  'databaseurl',
  'dsn',
  'idtoken',
  'password',
  'passwd',
  'privatekey',
  'proxyauthorization',
  'pwd',
  'refreshtoken',
  'secret',
  'setcookie',
  'signingsecret',
  'secretaccesskey',
  'token',
  'webhooksecret',
]);

const SENSITIVE_KEY_SUFFIXES = [
  'accesstoken',
  'apikey',
  'apisecret',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'credential',
  'credentials',
  'password',
  'privatekey',
  'refreshtoken',
  'signingsecret',
  'webhooksecret',
];

const ASSIGNMENT_KEY_PATTERN =
  '(?:[a-z0-9_-]*(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|credential|password|passwd|private[_-]?key|refresh[_-]?token|secret[_-]?access[_-]?key|signing[_-]?secret|token|webhook[_-]?secret)|authorization|proxy-authorization|cookie|set-cookie|pwd|secret)';

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith('token') ||
    SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function redactStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactStructuredValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        isSensitiveKey(key) ? REDACTION_MARKER : redactStructuredValue(entryValue),
      ]),
    );
  }

  return typeof value === 'string' ? redactSensitiveText(value) : value;
}

function redactHeaderLines(text: string): string {
  return text.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie)(\s*:\s*)[^\r\n]+/gi,
    (_match, name: string, separator: string) => `${name}${separator}${REDACTION_MARKER}`,
  );
}

function redactAssignments(text: string): string {
  const quotedValuePattern = new RegExp(
    `((?:["']?${ASSIGNMENT_KEY_PATTERN}["']?)\\s*[:=]\\s*)(["'])([\\s\\S]*?)\\2`,
    'gi',
  );
  const unquotedValuePattern = new RegExp(
    `((?:["']?${ASSIGNMENT_KEY_PATTERN}["']?)\\s*[:=]\\s*)([^\\s,;}&\\]"']+)`,
    'gi',
  );

  return text
    .replace(quotedValuePattern, (_match, prefix: string, quote: string) => {
      return `${prefix}${quote}${REDACTION_MARKER}${quote}`;
    })
    .replace(unquotedValuePattern, (_match, prefix: string) => {
      return `${prefix}${REDACTION_MARKER}`;
    });
}

export function redactSensitiveText(input: string): string {
  let redacted = input;

  redacted = redacted.replace(
    /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi,
    REDACTION_MARKER,
  );
  redacted = redacted.replace(
    /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*/gi,
    REDACTION_MARKER,
  );
  redacted = redactHeaderLines(redacted);
  redacted = redacted.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
    (_match, scheme: string) => `${scheme} ${REDACTION_MARKER}`,
  );
  redacted = redacted.replace(
    /([?&](?:api[_-]?key|api[_-]?secret|access[_-]?token|auth|authorization|key|password|refresh[_-]?token|secret|signature|sig|token)=)[^&#\s]+/gi,
    `$1${REDACTION_MARKER}`,
  );
  redacted = redacted.replace(
    /([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@/\s]+@/gi,
    `$1${REDACTION_MARKER}@`,
  );
  redacted = redacted.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    REDACTION_MARKER,
  );
  redacted = redacted.replace(
    /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    REDACTION_MARKER,
  );

  return redactAssignments(redacted);
}

export function formatRedactedToolDetail(
  input: string | undefined,
  maxCharacters = DEFAULT_MAX_DETAIL_CHARACTERS,
): RedactedToolDetail | null {
  if (!input?.trim()) {
    return null;
  }

  let formatted: string;
  try {
    const parsed = JSON.parse(input);
    const redacted = redactStructuredValue(parsed);
    formatted = JSON.stringify(redacted, null, 2) ?? '';
  } catch {
    formatted = redactSensitiveText(input);
  }

  const safeLimit = Math.max(1, maxCharacters);
  if (formatted.length <= safeLimit) {
    return { text: formatted, truncated: false };
  }

  return {
    text: `${formatted.slice(0, safeLimit).trimEnd()}\n…`,
    truncated: true,
  };
}

export function limitRedactedToolDetail(
  detail: RedactedToolDetail | null,
  maxCharacters: number,
): RedactedToolDetail | null {
  if (!detail) {
    return null;
  }

  const safeLimit = Math.max(1, maxCharacters);
  if (detail.text.length <= safeLimit) {
    return detail;
  }

  return {
    text: `${detail.text.slice(0, safeLimit).trimEnd()}\n…`,
    truncated: true,
  };
}

export { REDACTION_MARKER };
