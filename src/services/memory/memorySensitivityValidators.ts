import type { MemoryFactSensitivity } from './facts/applicabilityProvenance';

const CREDENTIAL_PATTERNS = [
  /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----[\r\n]+[A-Za-z0-9+/=\r\n]{32,}-----END \1-----/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/u,
  /\bglpat-[A-Za-z0-9_-]{20,255}\b/u,
  /\bnpm_[A-Za-z0-9]{36}\b/u,
  /\bpypi-[A-Za-z0-9_-]{50,255}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/u,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,255}\b/u,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|https?|ssh|sftp|ftps?):\/\/[^\s:/@]+:[^\s/@]+@[^\s/]+/iu,
] as const;

const EMAIL_PATTERN = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;
const INTERNATIONAL_PHONE_PATTERN = /(?:^|[^\p{L}\p{N}])(\+[1-9](?:[ ().-]*\d){7,14})(?!\d)/gu;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/giu;
const PAYMENT_CARD_PATTERN = /(?:^|[^\d])((?:\d[ -]?){12,18}\d)(?!\d)/gu;
const PRECISE_COORDINATE_PATTERN =
  /(?:^|[^\d])(-?\d{1,2}\.\d{4,})\s*[,;]\s*(-?\d{1,3}\.\d{4,})(?!\d)/gu;
const SSN_PATTERN = /\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/u;
const BSN_PATTERN = /(?:^|[^\d])(\d{9})(?!\d)/gu;
const JWT_CANDIDATE_PATTERN = /\b([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\b/gu;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function decodedBase64UrlJson(segment: string): Record<string, unknown> | null {
  if (segment.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/u.test(segment)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;
  for (const character of segment) {
    const value = BASE64URL_ALPHABET.indexOf(character);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
      buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0 && buffer !== 0) return null;
  try {
    const encoded = bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
    const parsed: unknown = JSON.parse(decodeURIComponent(encoded));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasValidatedJwt(text: string): boolean {
  for (const match of text.matchAll(JWT_CANDIDATE_PATTERN)) {
    const header = decodedBase64UrlJson(match[1]);
    const payload = decodedBase64UrlJson(match[2]);
    if (header && payload && typeof header.alg === 'string' && header.alg.length > 0) return true;
  }
  return false;
}

function containsCredentialStructure(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text)) || hasValidatedJwt(text);
}

function hasInternationalPhone(text: string): boolean {
  for (const match of text.matchAll(INTERNATIONAL_PHONE_PATTERN)) {
    const digits = match[1].replace(/\D/gu, '');
    if (digits.length >= 8 && digits.length <= 15) return true;
  }
  return false;
}

function ibanMod97(value: string): number {
  const rearranged = `${value.slice(4)}${value.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

function hasValidatedIban(text: string): boolean {
  for (const match of text.toUpperCase().matchAll(IBAN_PATTERN)) {
    const candidate = match[0].replace(/ /gu, '');
    if (
      candidate.length >= 15 &&
      candidate.length <= 34 &&
      /^[A-Z]{2}\d{2}[A-Z0-9]+$/u.test(candidate) &&
      ibanMod97(candidate) === 1
    ) {
      return true;
    }
  }
  return false;
}

function passesLuhn(value: string): boolean {
  let total = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    doubleDigit = !doubleDigit;
  }
  return total % 10 === 0;
}

function hasPaymentIssuerPrefix(value: string): boolean {
  const length = value.length;
  const firstTwo = Number(value.slice(0, 2));
  const firstThree = Number(value.slice(0, 3));
  const firstFour = Number(value.slice(0, 4));
  const firstSix = Number(value.slice(0, 6));
  if (value.startsWith('4') && (length === 13 || length === 16 || length === 19)) return true;
  if (
    length === 16 &&
    ((firstTwo >= 51 && firstTwo <= 55) || (firstFour >= 2221 && firstFour <= 2720))
  ) {
    return true;
  }
  if (length === 15 && (value.startsWith('34') || value.startsWith('37'))) return true;
  if (
    (length === 16 || length === 19) &&
    (value.startsWith('6011') ||
      value.startsWith('65') ||
      (firstThree >= 644 && firstThree <= 649) ||
      (firstSix >= 622126 && firstSix <= 622925))
  ) {
    return true;
  }
  if (length === 16 && firstFour >= 3528 && firstFour <= 3589) return true;
  return (
    length === 14 &&
    ((firstThree >= 300 && firstThree <= 305) || value.startsWith('36') || value.startsWith('38'))
  );
}

function hasValidatedPaymentCard(text: string): boolean {
  for (const match of text.matchAll(PAYMENT_CARD_PATTERN)) {
    const candidate = match[1].replace(/\D/gu, '');
    if (hasPaymentIssuerPrefix(candidate) && passesLuhn(candidate)) return true;
  }
  return false;
}

function hasPreciseCoordinates(text: string): boolean {
  for (const match of text.matchAll(PRECISE_COORDINATE_PATTERN)) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return true;
  }
  return false;
}

function isValidBsn(value: string): boolean {
  if (value === '000000000') return false;
  const digits = [...value].map(Number);
  const weighted = digits
    .slice(0, 8)
    .reduce((sum, digit, index) => sum + digit * (9 - index), -digits[8]);
  return weighted > 0 && weighted % 11 === 0;
}

function hasGovernmentId(text: string): boolean {
  if (SSN_PATTERN.test(text)) return true;
  for (const match of text.matchAll(BSN_PATTERN)) {
    if (isValidBsn(match[1])) return true;
  }
  return false;
}

/** High-confidence secret and PII formats independent of field names or locale. */
export function classifyStructuredMemoryText(text: string): MemoryFactSensitivity | null {
  const normalized = text.normalize('NFKC');
  if (containsCredentialStructure(normalized)) return 'restricted';
  if (
    EMAIL_PATTERN.test(normalized) ||
    hasInternationalPhone(normalized) ||
    hasValidatedIban(normalized) ||
    hasValidatedPaymentCard(normalized) ||
    hasPreciseCoordinates(normalized) ||
    hasGovernmentId(normalized)
  ) {
    return 'sensitive';
  }
  return null;
}
