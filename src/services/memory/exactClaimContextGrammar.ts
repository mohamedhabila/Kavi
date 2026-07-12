export interface ExactClaimContextToken {
  lower: string;
  quoted: boolean;
}

const CONTEXT_PREFIXES: readonly (readonly string[])[] = [
  [],
  ['actually'],
  ['as', 'a', 'rule'],
  ['as', 'a', 'general', 'rule'],
  ['by', 'default'],
  ['currently'],
  ['from', 'now', 'on'],
  ['generally'],
  ['going', 'forward'],
  ['in', 'general'],
  ['normally'],
  ['overall'],
  ['personally'],
  ['typically'],
  ['usually'],
  ['doorgaans'],
  ['in', 'het', 'algemeen'],
  ['over', 'het', 'algemeen'],
  ['généralement'],
  ['en', 'général'],
  ['voortaan'],
  ['désormais'],
];
const NON_DURABLE_CONTEXT_MARKERS = new Set(
  'current next now one only single this today tomorrow tonight upcoming friday monday saturday sunday thursday tuesday wednesday january february march april may june july august september october november december vrijdag maandag zaterdag zondag donderdag dinsdag woensdag januari februari maart april mei juni juli augustus september oktober november december vendredi lundi samedi dimanche jeudi mardi mercredi janvier février mars avril mai juin juillet août septembre octobre novembre décembre freitag montag samstag sonntag donnerstag dienstag mittwoch januar februar märz april mai juni juli august september oktober november dezember'.split(
    ' ',
  ),
);
const RECURRING_CONTEXT_MARKERS = new Set(
  'all each every recurring weekly alle elke wekelijks wekelijkse tous toutes chaque hebdomadaire hebdomadaires wiederkehrend wöchentlich wöchentliche wöchentlichen cada semanal semanais'.split(
    ' ',
  ),
);
const CONTEXT_INSTANCE_DETERMINERS = new Set(
  'a an the this that these those de het deze dit le la les ce cet cette el los las este esta estos estas o os as este esta estes estas der die das ein eine dieser diese dieses'.split(
    ' ',
  ),
);
const CONTEXT_SCOPE_START_MARKERS = new Set(
  'about above across after against along alongside amid amidst among around at before behind below beneath beside besides between beyond by concerning considering despite down during except following for from in inside into like near off on onto opposite outside over past per regarding round since through throughout till toward towards under underneath unlike until up upon versus via with within without voor tijdens tot na bij op binnen buiten door langs onder boven rond rondom tegenover tussen pour pendant avant après autour chez contre dans depuis derrière devant durant entre hors jusque jusquà lors par parmi près sous sur vers via para durante hasta tras antes bajo contra desde durante entre hacia por sobre según sin für während bis nach bei an auf aus durch gegen hinter in neben über unter vor zwischen'.split(
    ' ',
  ),
);
const CONTEXT_SCOPE_END_MARKERS = new Set(
  'am are is to ben bent op zijn est sont à ist sind zu es son a é são'.split(' '),
);

function matchesExact(tokens: readonly ExactClaimContextToken[], expected: readonly string[]) {
  return (
    tokens.length === expected.length && tokens.every((token, i) => token.lower === expected[i])
  );
}

export function isContextScopeStartMarker(value: string): boolean {
  return CONTEXT_SCOPE_START_MARKERS.has(value);
}

export function isContextScopeEndMarker(value: string): boolean {
  return CONTEXT_SCOPE_END_MARKERS.has(value);
}

export function isPredicateContextPrefix(
  tokens: readonly ExactClaimContextToken[],
  isPredicateUnit: (value: string) => boolean,
): boolean {
  if (!isContextScopeStartMarker(tokens[0]?.lower ?? '')) return false;
  let rawContent = tokens.slice(1);
  if (isContextScopeEndMarker(rawContent.at(-1)?.lower ?? '')) rawContent = rawContent.slice(0, -1);
  if (
    rawContent.some(
      (token) =>
        /\p{N}/u.test(token.lower) ||
        CONTEXT_INSTANCE_DETERMINERS.has(token.lower) ||
        token.lower.split(/[-_+]/u).some((unit) => NON_DURABLE_CONTEXT_MARKERS.has(unit)),
    )
  ) {
    return false;
  }
  const hasRecurringShape = rawContent.some(
    (token) =>
      RECURRING_CONTEXT_MARKERS.has(token.lower) ||
      token.lower.endsWith('s') ||
      token.lower.endsWith('en'),
  );
  const content = rawContent.filter((token) => !RECURRING_CONTEXT_MARKERS.has(token.lower));
  return (
    hasRecurringShape &&
    content.length > 0 &&
    content.every((token) => isPredicateUnit(token.lower))
  );
}

export function hasAdmissibleContextPrefix(
  tokens: readonly ExactClaimContextToken[],
  isPredicateUnit: (value: string) => boolean,
): boolean {
  return (
    tokens.every((token) => !token.quoted) &&
    (CONTEXT_PREFIXES.some((candidate) => matchesExact(tokens, candidate)) ||
      isPredicateContextPrefix(tokens, isPredicateUnit))
  );
}
