// ---------------------------------------------------------------------------
// Kavi — System prompt truncation
// ---------------------------------------------------------------------------
// Cuts a system prompt down to a token budget. Extracted out of
// `budgetManager.ts` to keep that file under the maintainability line limit;
// the budget *allocation* decisions (how many tokens a protected section may
// borrow, etc.) stay in `budgetManager.ts` — this module only knows how to
// shrink text to fit a budget once that decision has been made.
//
// Grapheme-safe throughout: cuts never split a surrogate pair, an emoji ZWJ
// sequence, or a base letter from its combining mark (see
// `src/utils/graphemes.ts`), and prefer a sentence or whitespace boundary
// near the target cut over an exact character count.

import { CHARS_PER_TOKEN, estimateTokens } from './tokenCounter';
import { SAFETY_MARGIN } from './tokenCalibration';
import {
  exceedsGraphemeLength,
  graphemeLength,
  truncateGraphemesFromEnd,
  truncateGraphemesTo,
} from '../../utils/graphemes';

/**
 * Truncate a system prompt to fit within the token budget.
 * Preserves the beginning (base prompt + persona) and end (tool guidelines).
 * Trims the middle (memory, skills details) using head+tail strategy.
 */
export function truncateSystemPrompt(
  prompt: string,
  budgetTokens: number,
  family?: string,
): string {
  const currentTokens = estimateTokens(prompt, family);
  if (currentTokens <= budgetTokens) return prompt;

  // Convert the token budget to an approximate grapheme budget using the
  // Latin baseline ratio. System prompts are code-authored and predominantly
  // Latin-script, so this stays a conservative (over-)estimate of the char
  // budget even for the rare non-Latin section; the truncation below is
  // grapheme-safe regardless of script.
  const budgetGraphemes = Math.floor(budgetTokens * CHARS_PER_TOKEN);
  return truncateSystemPromptToChars(prompt, budgetGraphemes);
}

function truncateSystemPromptToChars(prompt: string, budgetGraphemes: number): string {
  if (!exceedsGraphemeLength(prompt, budgetGraphemes)) return prompt;

  // Head+tail: 60% from beginning (base prompt), 40% from end (guidelines).
  // Grapheme-safe: never splits a surrogate pair, an emoji ZWJ sequence, or a
  // base letter from its combining mark. Prefers a sentence/whitespace
  // boundary near the cut over an exact character count.
  const notice = '\n\n[... context truncated to fit budget ...]\n\n';
  const available = Math.max(0, budgetGraphemes - graphemeLength(notice));
  const headSize = Math.floor(available * 0.6);
  const tailSize = available - headSize;

  const head = truncateGraphemesTo(prompt, headSize);
  const tail = truncateGraphemesFromEnd(prompt, tailSize);
  return `${head}${notice}${tail}`;
}

/**
 * Truncate `prompt` to `budgetTokens` while keeping `protectedSection`
 * verbatim at the end. Throws if `protectedSection` doesn't appear exactly
 * once in `prompt`, or can't fit the budget on its own.
 */
export function truncateSystemPromptPreservingSection(
  prompt: string,
  budgetTokens: number,
  protectedSection: string,
  family?: string,
): string {
  const firstIndex = prompt.indexOf(protectedSection);
  if (firstIndex < 0 || prompt.indexOf(protectedSection, firstIndex + 1) >= 0) {
    throw new Error('protected_system_prompt_section_missing_or_duplicated');
  }
  if (estimateTokens(protectedSection, family) > budgetTokens) {
    throw new Error('protected_system_prompt_section_exceeds_budget');
  }

  const separator = '\n\n';
  const maxGraphemes = Math.floor((budgetTokens * CHARS_PER_TOKEN) / SAFETY_MARGIN);
  const remainingMaxChars =
    maxGraphemes - graphemeLength(protectedSection) - graphemeLength(separator);
  if (remainingMaxChars <= 0) {
    throw new Error('protected_system_prompt_section_exceeds_budget');
  }
  const remainingPrompt = `${prompt.slice(0, firstIndex)}${prompt.slice(
    firstIndex + protectedSection.length,
  )}`.trim();
  const truncatedRemaining = truncateSystemPromptToChars(remainingPrompt, remainingMaxChars);
  const adjusted = `${truncatedRemaining}${separator}${protectedSection}`;
  if (estimateTokens(adjusted, family) > budgetTokens || !adjusted.endsWith(protectedSection)) {
    throw new Error('protected_system_prompt_section_exceeds_budget');
  }
  return adjusted;
}
