/**
 * Terminal text sanitization for safe single-line rendering.
 *
 * Prevents terminal injection (CWE-117) by stripping ANSI escapes and control
 * characters from untrusted text before it is rendered in shell transcripts
 * or log displays.
 */

import { stripAnsi } from './ansi';

export function sanitizeTerminalText(input: string): string {
  const normalized = stripAnsi(input)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  let sanitized = '';
  for (const char of normalized) {
    const code = char.charCodeAt(0);
    const isControl = (code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
    if (!isControl) {
      sanitized += char;
    }
  }
  return sanitized;
}
