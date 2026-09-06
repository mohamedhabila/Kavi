// ---------------------------------------------------------------------------
// Kavi — Right-to-Left Locale Detection
// ---------------------------------------------------------------------------
// Decides whether a locale's script reads right-to-left, so the manager can
// drive React Native's `I18nManager` accordingly.
//
// Ideally this would ask the platform for the script's writing direction
// structurally (e.g. Unicode's script metadata) rather than hand-listing
// languages. `Intl.Locale`'s "Locale Info" `textInfo.direction` getter is
// exactly that, but it is a Stage-3 TC39 proposal: it is not declared in
// this project's pinned `typescript` lib types
// (node_modules/typescript/lib/lib.es2020.intl.d.ts has no `textInfo` on
// `Intl.Locale`), and Hermes's Intl implementation is a hand-written subset
// that is already missing longer-established APIs on this project's pinned
// version — see the comment in `pluralCategory.ts` about
// `Intl.RelativeTimeFormat` being absent on Hermes/Android despite
// `HERMES_ENABLE_INTL=True`. Calling an untyped, newer API that is
// virtually certain to be unimplemented here would need an `any` cast for
// no practical benefit.
//
// Instead this is a small, explicit table of RTL language subtags — a
// structural fact about each language (which way its script reads), not a
// heuristic over the *content* of any string. Only Arabic ships as a Kavi
// locale today; Hebrew, Persian, and Urdu are listed anyway so adding one
// of them later does not silently render the wrong direction.

const RTL_LANGUAGE_SUBTAGS: ReadonlySet<string> = new Set([
  'ar', // Arabic
  'he', // Hebrew
  'fa', // Persian / Farsi
  'ur', // Urdu
]);

/** The BCP-47 primary language subtag, e.g. `'ar'` from `'ar-EG'`. */
function primaryLanguageSubtag(bcp47Tag: string): string {
  return bcp47Tag.split('-')[0].toLowerCase();
}

/** True when `bcp47Tag`'s language is written right-to-left. */
export function isRtlLanguageTag(bcp47Tag: string): boolean {
  return RTL_LANGUAGE_SUBTAGS.has(primaryLanguageSubtag(bcp47Tag));
}
