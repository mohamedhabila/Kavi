import { decompressSync, strFromU8 } from 'fflate';
import { trimToUndefined } from '../projectState';

const WINDOWS_1252_EXTENDED_CHARS = [
  '\u20AC',
  '\u0081',
  '\u201A',
  '\u0192',
  '\u201E',
  '\u2026',
  '\u2020',
  '\u2021',
  '\u02C6',
  '\u2030',
  '\u0160',
  '\u2039',
  '\u0152',
  '\u008D',
  '\u017D',
  '\u008F',
  '\u0090',
  '\u2018',
  '\u2019',
  '\u201C',
  '\u201D',
  '\u2022',
  '\u2013',
  '\u2014',
  '\u02DC',
  '\u2122',
  '\u0161',
  '\u203A',
  '\u0153',
  '\u009D',
  '\u017E',
  '\u0178',
];

const WORKFLOW_LOG_ERROR_PATTERNS = [
  /(^|\s)(error|errors|fatal|exception|traceback)(\s|:|$)/i,
  /(^|\s)(failed|failure|failing)(\s|:|$)/i,
  /(^|\s)(assertionerror|typeerror|referenceerror|syntaxerror|module not found)(\s|:|$)/i,
  /(^|\s)(npm ERR!|yarn error|gradle.*failed|xcodebuild: error|command failed)(\s|:|$)/i,
];

type SupportedWorkflowTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
type SupportedWorkflowCompressionEncoding = 'brotli' | 'deflate';

const brotliJs = require('brotli-js') as {
  decompressArray(input: Uint8Array): ArrayLike<number>;
};

function getResponseHeaderValue(
  response: { headers?: { get?: (name: string) => string | null } | null },
  headerName: string,
): string | undefined {
  const headers = response.headers;
  if (!headers || typeof headers.get !== 'function') {
    return undefined;
  }
  return trimToUndefined(headers.get(headerName));
}

function normalizeWorkflowTextEncoding(
  label?: string | null,
): SupportedWorkflowTextEncoding | undefined {
  const normalized = trimToUndefined(label)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (['utf-8', 'utf8'].includes(normalized)) return 'utf-8';
  if (['utf-16', 'utf16', 'utf-16le', 'utf16le'].includes(normalized)) return 'utf-16le';
  if (['utf-16be', 'utf16be'].includes(normalized)) return 'utf-16be';
  if (
    ['ascii', 'cp1252', 'iso-8859-1', 'iso8859-1', 'latin1', 'latin-1', 'us-ascii', 'windows-1252'].includes(normalized)
  ) {
    return 'windows-1252';
  }
  return undefined;
}

function extractCharsetFromContentType(
  contentType?: string,
): SupportedWorkflowTextEncoding | undefined {
  const normalized = trimToUndefined(contentType);
  if (!normalized) {
    return undefined;
  }
  const match = normalized.match(/charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  const charset = match?.[1] || match?.[2];
  return normalizeWorkflowTextEncoding(charset);
}

function detectWorkflowTextBom(bytes: Uint8Array): SupportedWorkflowTextEncoding | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }
  return undefined;
}

function stripWorkflowTextBom(
  bytes: Uint8Array,
  encoding?: SupportedWorkflowTextEncoding,
): Uint8Array {
  if (
    encoding === 'utf-8' &&
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return bytes.subarray(3);
  }
  if ((encoding === 'utf-16le' || encoding === 'utf-16be') && bytes.length >= 2) {
    const isLittleEndianBom = bytes[0] === 0xff && bytes[1] === 0xfe;
    const isBigEndianBom = bytes[0] === 0xfe && bytes[1] === 0xff;
    if (isLittleEndianBom || isBigEndianBom) {
      return bytes.subarray(2);
    }
  }
  return bytes;
}

function decodeUtf16WorkflowText(bytes: Uint8Array, littleEndian: boolean): string {
  const view = stripWorkflowTextBom(bytes, littleEndian ? 'utf-16le' : 'utf-16be');
  const evenLength = view.length - (view.length % 2);
  if (evenLength <= 0) {
    return '';
  }
  const codeUnits: number[] = [];
  for (let index = 0; index < evenLength; index += 2) {
    codeUnits.push(
      littleEndian ? view[index] | (view[index + 1] << 8) : (view[index] << 8) | view[index + 1],
    );
  }
  let text = '';
  for (let index = 0; index < codeUnits.length; index += 4096) {
    text += String.fromCharCode(...codeUnits.slice(index, index + 4096));
  }
  return text;
}

function decodeWindows1252WorkflowText(bytes: Uint8Array): string {
  const chars: string[] = [];
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) {
      chars.push(WINDOWS_1252_EXTENDED_CHARS[byte - 0x80]);
    } else {
      chars.push(String.fromCharCode(byte));
    }
  }
  return chars.join('');
}

function decodeUtf8WorkflowText(bytes: Uint8Array): string {
  const view = stripWorkflowTextBom(bytes, 'utf-8');
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(view);
  }
  return strFromU8(view);
}

function decodeWorkflowTextBytes(bytes: Uint8Array, contentType?: string): string {
  const bomEncoding = detectWorkflowTextBom(bytes);
  const hintedEncoding = bomEncoding || extractCharsetFromContentType(contentType) || 'utf-8';
  switch (hintedEncoding) {
    case 'utf-16le':
      return decodeUtf16WorkflowText(bytes, true);
    case 'utf-16be':
      return decodeUtf16WorkflowText(bytes, false);
    case 'windows-1252':
      return decodeWindows1252WorkflowText(bytes);
    case 'utf-8':
    default: {
      const utf8Text = decodeUtf8WorkflowText(bytes);
      if (!bomEncoding && !extractCharsetFromContentType(contentType) && utf8Text.includes('\uFFFD')) {
        return decodeWindows1252WorkflowText(bytes);
      }
      return utf8Text;
    }
  }
}

function looksLikeDecodedWorkflowText(bytes: Uint8Array, contentType?: string): boolean {
  if (!bytes.length) {
    return false;
  }
  const sampleBytes = bytes.subarray(0, Math.min(bytes.length, 512));
  const sampleText = decodeWorkflowTextBytes(sampleBytes, contentType);
  const trimmed = sampleText.trim();
  if (!trimmed || sampleText.includes('\uFFFD')) {
    return false;
  }
  const visibleChars = Array.from(sampleText).filter((char) => {
    const code = char.charCodeAt(0);
    return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
  }).length;
  const controlChars = Array.from(sampleText).length - visibleChars;
  if (visibleChars === 0 || controlChars > Math.max(2, Math.floor(sampleText.length / 20))) {
    return false;
  }
  return /^[\[{("A-Za-z0-9@._/-]/.test(trimmed);
}

function extractWorkflowCompressionEncodings(
  contentEncoding?: string,
): SupportedWorkflowCompressionEncoding[] {
  const normalized = trimToUndefined(contentEncoding)?.toLowerCase();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(',')
    .map((segment) => segment.trim())
    .map((segment) => {
      if (segment === 'br') return 'brotli';
      if (/(gzip|x-gzip|deflate)/.test(segment)) return 'deflate';
      return undefined;
    })
    .filter((encoding): encoding is SupportedWorkflowCompressionEncoding => Boolean(encoding));
}

function decompressWorkflowTextBytes(
  bytes: Uint8Array,
  contentEncoding?: string,
  contentType?: string,
): Uint8Array {
  const encodings = extractWorkflowCompressionEncodings(contentEncoding);
  if (!encodings.length) {
    if (!looksCompressed(bytes)) {
      return bytes;
    }
    try {
      return new Uint8Array(decompressSync(bytes));
    } catch {
      return bytes;
    }
  }

  let output = bytes;
  let decompressed = false;
  for (const encoding of [...encodings].reverse()) {
    if (looksLikeDecodedWorkflowText(output, contentType)) {
      return output;
    }
    try {
      output =
        encoding === 'brotli'
          ? Uint8Array.from(brotliJs.decompressArray(output))
          : new Uint8Array(decompressSync(output));
      decompressed = true;
    } catch {
      return decompressed ? output : bytes;
    }
  }
  return output;
}

function shouldAttemptWorkflowLogDecompression(
  bytes: Uint8Array,
  contentEncoding?: string,
): boolean {
  return extractWorkflowCompressionEncodings(contentEncoding).length > 0 || looksCompressed(bytes);
}

function normalizeLogToken(value: string | undefined | null): string {
  return trimToUndefined(value)?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || '';
}

export function stripAnsiAndControlChars(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function looksLikeReadableLogText(text: string): boolean {
  if (!text || text.length < 4) return false;
  const sample = text.slice(0, 512);
  if (sample.includes('\uFFFD')) return false;
  const printable = Array.from(sample).filter((c) => {
    const code = c.charCodeAt(0);
    return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
  }).length;
  return printable > sample.length * 0.8;
}

export function excerptWorkflowLogText(text: string, maxChars = 5000): string {
  const sanitized = stripAnsiAndControlChars(text).trim();
  if (!sanitized) {
    return '';
  }
  const lines = sanitized.split(/\r?\n/);
  const focusIndex = lines.findIndex((line) => WORKFLOW_LOG_ERROR_PATTERNS.some((pattern) => pattern.test(line)));
  const excerpt =
    focusIndex >= 0
      ? lines.slice(Math.max(0, focusIndex - 4), Math.min(lines.length, focusIndex + 5)).join('\n')
      : sanitized;
  if (excerpt.length <= maxChars) {
    return excerpt;
  }
  return `${excerpt.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function looksCompressed(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return true;
  if (bytes[0] === 0x78 && (bytes[1] === 0x01 || bytes[1] === 0x9c || bytes[1] === 0xda)) return true;
  return false;
}

async function fetchDecompressedText(url: string | undefined): Promise<string | undefined> {
  const normalizedUrl = trimToUndefined(url);
  if (!normalizedUrl) {
    return undefined;
  }

  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    return undefined;
  }

  const contentType = getResponseHeaderValue(response, 'content-type');
  const contentEncoding = getResponseHeaderValue(response, 'content-encoding');

  if (typeof response.arrayBuffer === 'function') {
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const decodedBytes = shouldAttemptWorkflowLogDecompression(bytes, contentEncoding)
        ? decompressWorkflowTextBytes(bytes, contentEncoding, contentType)
        : bytes;
      const decodedText = decodeWorkflowTextBytes(decodedBytes, contentType);
      if (looksLikeReadableLogText(decodedText)) {
        return decodedText;
      }

      const fallbackText = decodeWorkflowTextBytes(bytes, contentType);
      if (looksLikeReadableLogText(fallbackText)) {
        return fallbackText;
      }
    } catch {
      // fall through
    }
  }

  if (typeof response.text === 'function') {
    const text = await response.text().catch(() => undefined);
    return trimToUndefined(text);
  }

  return undefined;
}

export { decodeWorkflowTextBytes, normalizeLogToken, fetchDecompressedText };
