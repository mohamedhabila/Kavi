export interface ExactPropertyDescriptorToken {
  value: string;
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

const INEXACT_NOMINAL_MORPHOLOGY =
  /(?:able|al|ary|ative|ed|ent|ial|ible|ic|ish|ive|likely|ory|ous|possible|probable|provisional|supposed|tentative)$/u;
const ADMISSIBLE_ADJECTIVAL_PROPERTY_DESCRIPTORS = new Set(
  'client dietary marital medical personal'.split(' '),
);
const ADMISSIBLE_PROPERTY_DESCRIPTOR_UNITS = new Set(
  'architecture architectuur architektur arquitectura arquitetura billing car cat citizenship client compliance conception concepción contact demo design design device dietary dog editor emergency family focus font github gpt home http iphone iso klant kunde meeting mobile model notification ontwerp ontwerpreview passport pet phone planning project python relationship response review revue revisión revisão server shoe slack sprint team vergadering work werk'.split(
    ' ',
  ),
);
const UNSAFE_PROPERTY_NOMINAL_UNITS = new Set(
  'a about above across after against alleged allegedly almost ambiguous an anytime apparently approximate approximately around as assuming at ballpark before behind below beneath beside besides between beyond by candidate circa conceivably considering currently despite down draft doubtful during effective either estimated except expected following for forecast from fuzzy hypothetical if in inside interim into likely maybe near nearly of off on onetime onto opposite ostensible outside over past per perhaps possible possibly presumed probable probably projected provisional provisionally putative regarding reported reportedly rough roughly round seems single speculative supposed supposedly suspected target tentative the this through throughout till today tomorrow tonight toward towards trial uncertain unclear under underneath unless unlike until up upon versus via when whenever where whether while whilst within without would'.split(
    ' ',
  ),
);
const NUMERIC_SCOPE_PREFIXES = new Set(
  'am date day fiscal fy hour month pm q quarter sprint time today tomorrow week year'.split(' '),
);
function markerUnits(value: string): string[] {
  return value.split(/[-_+]/u);
}

function isCodeOwnedPropertyDescriptorUnit(
  value: string,
  isNominalModifier: (value: string) => boolean,
): boolean {
  return (
    isNominalModifier(value) ||
    ADMISSIBLE_ADJECTIVAL_PROPERTY_DESCRIPTORS.has(value) ||
    ADMISSIBLE_PROPERTY_DESCRIPTOR_UNITS.has(value)
  );
}

function isTechnicalPropertyIdentifier(token: ExactPropertyDescriptorToken): boolean {
  const value = token.value.normalize('NFKC');
  return /^(?=[\p{Lu}\p{Lt}\p{N}_-]{2,}$)(?=[\p{Lu}\p{Lt}\p{N}_-]*\p{N})(?=[\p{Lu}\p{Lt}\p{N}_-]*[\p{Lu}\p{Lt}])[\p{Lu}\p{Lt}\p{N}]+(?:[-_][\p{Lu}\p{Lt}\p{N}]+)*$/u.test(
    value,
  );
}

function isCodeOwnedNumericDescriptorContinuation(
  previous: ExactPropertyDescriptorToken | undefined,
  isNominalModifier: (value: string) => boolean,
): boolean {
  return (
    previous !== undefined &&
    (isCodeOwnedPropertyDescriptorUnit(previous.lower, isNominalModifier) ||
      isTechnicalPropertyIdentifier(previous))
  );
}

function isStructuredNumericDescriptor(
  token: ExactPropertyDescriptorToken,
  previous: ExactPropertyDescriptorToken | undefined,
  isNominalModifier: (value: string) => boolean,
): boolean {
  const lower = token.lower;
  if (!/\p{N}/u.test(lower)) return true;
  if (
    /^(?:\p{N}{1,2}(?::?\p{N}{2})?(?:am|pm)|(?:\p{N}{4})?q\p{N}+|sprint[-_]?\p{N}+|\p{N}{4}q\p{N}+|\p{N}{1,4}(?:[-/.]\p{N}{1,2}){1,2})$/u.test(
      lower,
    )
  ) {
    return false;
  }
  if (/^\p{N}+$/u.test(lower)) {
    if (lower.length > 5 || !previous || /\p{N}/u.test(previous.lower)) return false;
    return (
      isCodeOwnedNumericDescriptorContinuation(previous, isNominalModifier) &&
      !NUMERIC_SCOPE_PREFIXES.has(previous.lower) &&
      !UNSAFE_PROPERTY_NOMINAL_UNITS.has(previous.lower)
    );
  }
  return /\p{L}/u.test(lower);
}

function hasAdmissibleOpenPropertyDescriptorCasing(token: ExactPropertyDescriptorToken): boolean {
  const value = token.value.normalize('NFKC').replace(/['’]s$/u, '');
  return value
    .split(/[-_+]/u)
    .every(
      (unit) =>
        /^(?:\p{Ll}[\p{Ll}\p{M}]*|\p{Lu}[\p{Ll}\p{M}]*|[\p{Lo}\p{M}]+)$/u.test(unit) ||
        (/^[\p{L}\p{M}\p{N}]+$/u.test(unit) &&
          /\p{Ll}/u.test(unit) &&
          /[\p{Lu}\p{Lt}]/u.test(unit)),
    );
}

function hasProperPropertyDescriptorCasing(token: ExactPropertyDescriptorToken): boolean {
  const value = token.value.normalize('NFKC').replace(/['’]s$/u, '');
  return /\p{Ll}/u.test(value) && /[\p{Lu}\p{Lt}]/u.test(value);
}

export function hasInexactPropertyNominalMorphology(value: string): boolean {
  return INEXACT_NOMINAL_MORPHOLOGY.test(value);
}

export function isUnsafePropertyNominalUnit(value: string): boolean {
  return UNSAFE_PROPERTY_NOMINAL_UNITS.has(value);
}

export function isCodeOwnedPropertyDescriptor(input: {
  token: ExactPropertyDescriptorToken;
  previous: ExactPropertyDescriptorToken | undefined;
  isNominalModifier: (value: string) => boolean;
}): boolean {
  const { token, previous, isNominalModifier } = input;
  const units = markerUnits(token.lower);
  const possessiveBase = token.lower.replace(/['’]s$/u, '');
  return (
    isCodeOwnedPropertyDescriptorUnit(token.lower, isNominalModifier) ||
    (possessiveBase !== token.lower &&
      isCodeOwnedPropertyDescriptorUnit(possessiveBase, isNominalModifier)) ||
    isTechnicalPropertyIdentifier(token) ||
    (/^\p{N}+$/u.test(token.lower) &&
      isCodeOwnedNumericDescriptorContinuation(previous, isNominalModifier)) ||
    (units.length > 1 &&
      units.every(
        (unit) =>
          isCodeOwnedPropertyDescriptorUnit(unit, isNominalModifier) || /^\p{N}+$/u.test(unit),
      ))
  );
}

export function isAdmissiblePropertyDescriptor(input: {
  token: ExactPropertyDescriptorToken;
  previous: ExactPropertyDescriptorToken | undefined;
  isNominalModifier: (value: string) => boolean;
  isPredicateUnit: (value: string) => boolean;
  hasUnsafeUnit: (token: ExactPropertyDescriptorToken) => boolean;
}): boolean {
  const { token, previous } = input;
  const codeOwnedDescriptor = isCodeOwnedPropertyDescriptor(input);
  const lexicalDescriptor =
    codeOwnedDescriptor ||
    ((hasProperPropertyDescriptorCasing(token) || !INEXACT_NOMINAL_MORPHOLOGY.test(token.lower)) &&
      hasAdmissibleOpenPropertyDescriptorCasing(token) &&
      input.isPredicateUnit(token.value));
  return (
    !input.hasUnsafeUnit(token) &&
    lexicalDescriptor &&
    isStructuredNumericDescriptor(token, previous, input.isNominalModifier)
  );
}
