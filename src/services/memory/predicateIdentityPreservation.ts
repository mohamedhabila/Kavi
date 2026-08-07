/**
 * Guards the predicate a fact is filed under when the user named it themselves.
 *
 * `memory_remember` already instructs the caller to keep a user-supplied identifier
 * exactly: "When the current user supplies an explicit predicate, field, or key
 * identifier, preserve it exactly; do not add grammatical prefixes or rename it." Nothing
 * enforced it, so a decorated predicate was accepted and the fact filed where the name
 * the user used would never find it. The write reports success, the run finalizes, and
 * the loss only surfaces later when recall returns nothing.
 *
 * Traced live: asked to "remember subject `bfcl-direct` has checksum_token
 * `BFCL-DIRECT-CHECK-42`", the caller filed it under `has_checksum_token` — folding the
 * English verb into the identifier. Seven other runs of the same request used
 * `checksum_token` and were recalled correctly.
 *
 * The check is structural rather than linguistic: it never looks for particular words
 * such as "has" or "is". It asks only whether the user's own message contains, as a
 * standalone token, a shorter identifier-shaped run of the predicate's own segments. If
 * it does, the caller took an identifier the user wrote and added to it, which is the one
 * case the instruction forbids. A predicate the caller composed itself, and a bare word
 * that merely occurs in the message, both pass untouched.
 */

/** Segment separators an identifier may legitimately use. */
const IDENTIFIER_SEGMENT_PATTERN = /[^A-Za-z0-9]+/;

function segmentsOf(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(IDENTIFIER_SEGMENT_PATTERN)
    .filter(Boolean);
}

/**
 * Whether `token` appears in `text` bounded by non-identifier characters, so a match is
 * the user naming that identifier rather than an incidental substring of a longer word.
 */
function containsStandaloneToken(text: string, token: string): boolean {
  const haystack = text.toLowerCase();
  let index = haystack.indexOf(token);
  while (index !== -1) {
    const before = index === 0 ? '' : haystack[index - 1]!;
    const afterIndex = index + token.length;
    const after = afterIndex >= haystack.length ? '' : haystack[afterIndex]!;
    const boundedBefore = before === '' || IDENTIFIER_SEGMENT_PATTERN.test(before);
    const boundedAfter = after === '' || IDENTIFIER_SEGMENT_PATTERN.test(after);
    if (boundedBefore && boundedAfter) {
      return true;
    }
    index = haystack.indexOf(token, index + 1);
  }
  return false;
}

/**
 * The identifier the user wrote, when the supplied predicate is a decorated form of it.
 * Returns undefined when the predicate is the caller's own semantic relation, which the
 * tool explicitly allows, or when the user used the predicate verbatim.
 */
export function findUserSuppliedPredicateIdentity(params: {
  predicate: string;
  userMessageText: string;
}): string | undefined {
  const predicate = params.predicate.trim();
  const message = params.userMessageText ?? '';
  if (!predicate || !message.trim()) {
    return undefined;
  }
  if (containsStandaloneToken(message, predicate.toLowerCase())) {
    return undefined;
  }

  // Only an identifier can be a decorated identifier. A predicate written as a phrase is
  // the caller's own semantic relation, which the tool explicitly allows even when the
  // user's message happens to contain a related token — `preferred display name` beside a
  // message mentioning `display_name` is a description, not a rename.
  if (/\s/.test(predicate)) {
    return undefined;
  }

  const segments = segmentsOf(predicate);
  if (segments.length < 2) {
    return undefined;
  }

  // The candidate must itself be identifier-shaped — at least two segments joined by a
  // separator, as the user actually typed it. A single ordinary word that happens to
  // appear in the message is not the user supplying an identifier: `review_duration`
  // beside a message mentioning "review" is a compound relation the caller is entitled
  // to name, while `checksum_token` written verbatim in the message is not.
  for (let length = segments.length - 1; length >= 2; length -= 1) {
    for (let start = 0; start + length <= segments.length; start += 1) {
      const candidate = segments.slice(start, start + length).join('_');
      if (containsStandaloneToken(message, candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** Correction handed back when a user-supplied identifier was renamed. */
export function buildPredicateIdentityCorrection(params: {
  predicate: string;
  userSuppliedIdentity: string;
}): string {
  return (
    `predicate_renamed: the current user wrote \`${params.userSuppliedIdentity}\`, and this ` +
    `call files the fact under \`${params.predicate}\` instead. A fact stored under a ` +
    `different name than the user used cannot be recalled by the name they will ask for. ` +
    `Retry with predicate \`${params.userSuppliedIdentity}\` exactly, keeping subject, ` +
    `value, and scope unchanged.`
  );
}
