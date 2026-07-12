import {
  isExactBeveragePreferenceValue,
  isExactMaritalStatus,
  isExactNationalityIdentity,
  isExactPetOwnershipValue,
} from './exactCommonSelfFactValues';
import {
  isExactAgeImplicitSelfRelation,
  isExactAgeRelationSurface,
  matchExactAgePhrase,
} from './exactAgePhraseGrammar';

export interface ExactSelfRelationToken {
  value: string;
  lower: string;
  start: number;
  end: number;
  quoted: boolean;
}

type SelfRelationFamilyId =
  | 'accessibility_requirement'
  | 'age'
  | 'avoidance'
  | 'birth_date'
  | 'children'
  | 'commute_mode'
  | 'dietary_identity'
  | 'drink_preference'
  | 'marital_status'
  | 'nationality'
  | 'occupation'
  | 'ownership'
  | 'pet_ownership'
  | 'preference'
  | 'preferred_name'
  | 'residence'
  | 'spoken_language'
  | 'tool_usage'
  | 'upbringing'
  | 'wear_size'
  | 'work';

interface SelfRelationFamily {
  id: SelfRelationFamilyId;
  predicateAnchors: ReadonlySet<string>;
  predicateVocabulary: ReadonlySet<string>;
}

const SELF_RELATION_CONTRACTION_OPERATIONS: Readonly<Record<string, 'am' | 'have'>> = {
  "i'm": 'am',
  'i’m': 'am',
  "i've": 'have',
  'i’ve': 'have',
};
const SELF_RELATION_SURFACES = new Set(
  "am are ben bin sou soy suis avoid avoids born commute commutes go goes grew have has keep keeps like likes live lives move moved need needs own owns prefer prefers reside resides speak speaks use uses wear wears work works i'm i’m i've i’ve noem noemt woon woont verhuis verhuisd verkies verkiest gebruik gebruikt werk werkt appelle appelles habite habites déménage préfère préfères utilise utilises travaille travailles nenne nennt wohne wohnt ziehe zog bevorzuge bevorzugt nutze nutzt arbeite arbeitet llama llamo vive vivo mudé prefiero usa uso trabaja trabajo chama chamo mora moro mudei prefiro usa uso trabalha trabalho".split(
    ' ',
  ),
);
const SELF_RELATION_OPERATIONS: Readonly<Record<string, string>> = {
  ...SELF_RELATION_CONTRACTION_OPERATIONS,
  are: 'am',
  ben: 'am',
  bin: 'am',
  sou: 'am',
  soy: 'am',
  suis: 'am',
  woon: 'live',
  woont: 'live',
  habite: 'live',
  habites: 'live',
  wohne: 'live',
  wohnt: 'live',
  vive: 'live',
  vivo: 'live',
  mora: 'live',
  moro: 'live',
  verkies: 'prefer',
  verkiest: 'prefer',
  préfère: 'prefer',
  préfères: 'prefer',
  bevorzuge: 'prefer',
  bevorzugt: 'prefer',
  prefiero: 'prefer',
  prefiro: 'prefer',
  werk: 'work',
  werkt: 'work',
  travaille: 'work',
  travailles: 'work',
  arbeite: 'work',
  arbeitet: 'work',
  trabaja: 'work',
  trabajo: 'work',
  trabalha: 'work',
  trabalho: 'work',
  gebruik: 'use',
  gebruikt: 'use',
  utilise: 'use',
  utilises: 'use',
  nutze: 'use',
  nutzt: 'use',
  usa: 'use',
  uso: 'use',
  verhuis: 'move',
  verhuisd: 'move',
  déménage: 'move',
  ziehe: 'move',
  zog: 'move',
  mudé: 'move',
  mudei: 'move',
};

const EXACT_COPULA_BY_SUBJECT: Readonly<Record<string, string>> = {
  eu: 'sou',
  i: 'am',
  ich: 'bin',
  ik: 'ben',
  je: 'suis',
  yo: 'soy',
};

const DIETARY_IDENTITIES = new Set(
  'vegetarian vegan pescatarian flexitarian halal kosher plant-based plantbased'.split(' '),
);
const OCCUPATION_HEADS = new Set(
  'accountant architect artist attorney chef consultant dentist designer developer doctor educator engineer entrepreneur journalist lawyer manager nurse pharmacist professor researcher scientist student teacher therapist writer'.split(
    ' ',
  ),
);
const ACCESSIBILITY_VALUE_UNITS = new Set(
  'access accessibility accessible accommodation captions caption interpreter ramp ramps screen-reader screenreader step-free stepfree wheelchair'.split(
    ' ',
  ),
);
const TRANSPORT_MODES = new Set(
  'bike bicycle bus car cycling ferry metro motorcycle scooter subway train tram walking'.split(
    ' ',
  ),
);
const SIZE_VALUE_PATTERN = /^(?:\p{N}+(?:[.,]\p{N}+)?|xxxs|xxs|xs|s|m|l|xl|xxl|xxxl)$/u;
const DATE_VALUE_PATTERN =
  /^(?:(?:[1-9]|[12]\p{N}|3[01])\s+\p{L}[\p{L}\p{M}]*|\p{L}[\p{L}\p{M}]*\s+(?:[1-9]|[12]\p{N}|3[01])|\p{N}{4}-\p{N}{1,2}-\p{N}{1,2}|\p{N}{1,2}[/.]\p{N}{1,2}[/.]\p{N}{2,4})$/u;
const COUNTED_CHILD_PATTERN =
  /^(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\p{N}+)(?:\s+\p{L}+){0,2}\s+)?(?:child|children|kid|kids)$/u;
const GENERIC_PREDICATE_UNITS = new Set(
  'a an as at by current default for from general in is my of on preferred self the to user usual'.split(
    ' ',
  ),
);
const ANSWER_RESPONSE_ALIASES = new Set('answer answers response responses'.split(' '));
const DURATION_VALUE_UNITS = new Set(
  'day days hour hours minute minutes month months second seconds week weeks year years'.split(' '),
);
const DURATION_PREDICATE_ALIASES = new Set('duration length time'.split(' '));
const SELF_RELATION_LEADING_MODIFIERS = new Set(
  'always generally normally typically usually'.split(' '),
);
const OPAQUE_VALUE_SCOPE_MARKERS = new Set(
  'at during for next now on temporary temporarily this today tomorrow tonight until wanneer tijdens voor pendant pour jusquà durante para hasta während für bis'.split(
    ' ',
  ),
);

function set(value: string): ReadonlySet<string> {
  return new Set(value.split(' '));
}

const FAMILIES: Readonly<Record<SelfRelationFamilyId, SelfRelationFamily>> = {
  accessibility_requirement: {
    id: 'accessibility_requirement',
    predicateAnchors: set('accessibility accommodation requirement need'),
    predicateVocabulary: set('access accessibility accommodation requirement need'),
  },
  age: {
    id: 'age',
    predicateAnchors: set('age aged old'),
    predicateVocabulary: set('age aged old'),
  },
  avoidance: {
    id: 'avoidance',
    predicateAnchors: set('avoid avoidance'),
    predicateVocabulary: set('avoid avoidance'),
  },
  birth_date: {
    id: 'birth_date',
    predicateAnchors: set('birth birthday born'),
    predicateVocabulary: set('birth birthday born date'),
  },
  children: {
    id: 'children',
    predicateAnchors: set('child children count dependent dependents kid kids'),
    predicateVocabulary: set('child children count dependent dependents kid kids'),
  },
  commute_mode: {
    id: 'commute_mode',
    predicateAnchors: set('commute commuting method mode transport transportation'),
    predicateVocabulary: set('commute commuting method mode transport transportation'),
  },
  dietary_identity: {
    id: 'dietary_identity',
    predicateAnchors: set('diet dietary vegetarian vegan pescatarian flexitarian'),
    predicateVocabulary: set('diet dietary identity vegetarian vegan pescatarian flexitarian'),
  },
  drink_preference: {
    id: 'drink_preference',
    predicateAnchors: set('beverage drink'),
    predicateVocabulary: set(
      'beverage drink favorite favourite like likes prefer preference prefers',
    ),
  },
  marital_status: {
    id: 'marital_status',
    predicateAnchors: set('marital marriage'),
    predicateVocabulary: set('marital marriage relationship status'),
  },
  nationality: {
    id: 'nationality',
    predicateAnchors: set('citizen citizenship national nationality'),
    predicateVocabulary: set('citizen citizenship identity national nationality'),
  },
  occupation: {
    id: 'occupation',
    predicateAnchors: set('career job occupation profession role work'),
    predicateVocabulary: set('career job occupation profession role work'),
  },
  ownership: {
    id: 'ownership',
    predicateAnchors: set('own ownership owns'),
    predicateVocabulary: set('own ownership owns'),
  },
  pet_ownership: {
    id: 'pet_ownership',
    predicateAnchors: set('pet'),
    predicateVocabulary: set('animal has have own ownership owns pet'),
  },
  preference: {
    id: 'preference',
    predicateAnchors: set('favorite favourite like likes prefer preference prefers'),
    predicateVocabulary: set('favorite favourite like likes prefer preference prefers'),
  },
  preferred_name: {
    id: 'preferred_name',
    predicateAnchors: set('call called name nickname'),
    predicateVocabulary: set('call called name nickname preferred'),
  },
  residence: {
    id: 'residence',
    predicateAnchors: set('live lives location residence reside resides'),
    predicateVocabulary: set(
      'address city home live lives location move moved residence reside resides',
    ),
  },
  spoken_language: {
    id: 'spoken_language',
    predicateAnchors: set('language speak speaks spoken'),
    predicateVocabulary: set('language speak speaks spoken'),
  },
  tool_usage: {
    id: 'tool_usage',
    predicateAnchors: set('tool usage use uses using'),
    predicateVocabulary: set('app application editor tool usage use uses using'),
  },
  upbringing: {
    id: 'upbringing',
    predicateAnchors: set('grew hometown raised upbringing'),
    predicateVocabulary: set('grew hometown origin raised upbringing'),
  },
  wear_size: {
    id: 'wear_size',
    predicateAnchors: set('size wear wears'),
    predicateVocabulary: set('size wear wears'),
  },
  work: {
    id: 'work',
    predicateAnchors: set('career job occupation profession work works'),
    predicateVocabulary: set('career job occupation profession role work works'),
  },
};

function morphologicalForms(value: string): Set<string> {
  const forms = new Set([value]);
  if (value.length > 3 && value.endsWith('s')) forms.add(value.slice(0, -1));
  if (value.length > 4 && value.endsWith('es')) forms.add(value.slice(0, -2));
  if (value.length > 4 && value.endsWith('ed')) forms.add(value.slice(0, -2));
  if (value.length > 5 && value.endsWith('ing')) forms.add(value.slice(0, -3));
  return forms;
}

function lexicalUnits(value: string): string[] {
  return Array.from(
    value
      .normalize('NFKC')
      .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
      .toLocaleLowerCase()
      .matchAll(/[\p{L}\p{M}\p{N}]+/gu),
    (match) => match[0],
  );
}

function tokensMatch(tokens: readonly ExactSelfRelationToken[], expected: readonly string[]) {
  return (
    tokens.length === expected.length && tokens.every((token, i) => token.lower === expected[i])
  );
}

function hasExactPetOwnershipBridge(input: {
  bridge: readonly ExactSelfRelationToken[];
  value: string;
  allowGot: boolean;
}): boolean {
  const valueStartsWithArticle = /^(?:a|an)\s/u.test(
    input.value.normalize('NFKC').toLocaleLowerCase().trim(),
  );
  const candidates = valueStartsWithArticle
    ? input.allowGot
      ? [[], ['got']]
      : [[]]
    : input.allowGot
      ? [[], ['a'], ['an'], ['got', 'a'], ['got', 'an']]
      : [[], ['a'], ['an']];
  return candidates.some((candidate) => tokensMatch(input.bridge, candidate));
}

function classifyFamily(input: {
  relation: string;
  sourceRelation: string;
  bridge: readonly ExactSelfRelationToken[];
  value: string;
}): SelfRelationFamily | null {
  const value = input.value.normalize('NFKC').toLocaleLowerCase().trim();
  const valueUnits = lexicalUnits(value);
  const hasOpaqueScope = valueUnits.some((unit) => OPAQUE_VALUE_SCOPE_MARKERS.has(unit));
  const articleBridge =
    input.bridge.length === 0 ||
    tokensMatch(input.bridge, ['a']) ||
    tokensMatch(input.bridge, ['an']);

  if (['am', 'are'].includes(input.relation)) {
    if (!articleBridge) return null;
    if (DIETARY_IDENTITIES.has(value)) return FAMILIES.dietary_identity;
    if (isExactNationalityIdentity(value)) return FAMILIES.nationality;
    if (isExactMaritalStatus(value)) return FAMILIES.marital_status;
    if (input.bridge.length > 0 && OCCUPATION_HEADS.has(valueUnits.at(-1) ?? '')) {
      return FAMILIES.occupation;
    }
    return null;
  }
  if (['have', 'has'].includes(input.relation)) {
    if (
      isExactPetOwnershipValue(value) &&
      hasExactPetOwnershipBridge({
        bridge: input.bridge,
        value,
        allowGot: Object.prototype.hasOwnProperty.call(
          SELF_RELATION_CONTRACTION_OPERATIONS,
          input.sourceRelation,
        ),
      })
    ) {
      return FAMILIES.pet_ownership;
    }
    return input.bridge.length === 0 && COUNTED_CHILD_PATTERN.test(value)
      ? FAMILIES.children
      : null;
  }
  if (['own', 'owns'].includes(input.relation)) {
    if (
      isExactPetOwnershipValue(value) &&
      hasExactPetOwnershipBridge({ bridge: input.bridge, value, allowGot: false })
    ) {
      return FAMILIES.pet_ownership;
    }
    return articleBridge && !hasOpaqueScope && valueUnits.length > 0 && valueUnits.length <= 4
      ? FAMILIES.ownership
      : null;
  }
  if (['go', 'goes'].includes(input.relation)) {
    return tokensMatch(input.bridge, ['by']) ? FAMILIES.preferred_name : null;
  }
  if (['like', 'likes', 'prefer', 'prefers'].includes(input.relation)) {
    if (input.bridge.length === 0 && !hasOpaqueScope && isExactBeveragePreferenceValue(value)) {
      return FAMILIES.drink_preference;
    }
    return input.bridge.length === 0 && !hasOpaqueScope ? FAMILIES.preference : null;
  }
  if (['keep', 'keeps'].includes(input.relation)) {
    return input.bridge.length >= 2 && input.bridge.at(-1)?.lower === 'to'
      ? FAMILIES.preference
      : null;
  }
  if (['need', 'needs'].includes(input.relation)) {
    return input.bridge.length === 0 &&
      !hasOpaqueScope &&
      valueUnits.some((unit) => ACCESSIBILITY_VALUE_UNITS.has(unit))
      ? FAMILIES.accessibility_requirement
      : null;
  }
  if (['avoid', 'avoids'].includes(input.relation)) {
    return input.bridge.length === 0 && !hasOpaqueScope ? FAMILIES.avoidance : null;
  }
  if (input.relation === 'born') {
    return tokensMatch(input.bridge, ['on']) && DATE_VALUE_PATTERN.test(value)
      ? FAMILIES.birth_date
      : null;
  }
  if (input.relation === 'grew') {
    return (tokensMatch(input.bridge, ['up', 'in']) || tokensMatch(input.bridge, ['up', 'near'])) &&
      valueUnits.length > 0
      ? FAMILIES.upbringing
      : null;
  }
  if (['commute', 'commutes'].includes(input.relation)) {
    return (tokensMatch(input.bridge, ['by']) || tokensMatch(input.bridge, ['via'])) &&
      TRANSPORT_MODES.has(value)
      ? FAMILIES.commute_mode
      : null;
  }
  if (['wear', 'wears'].includes(input.relation)) {
    return tokensMatch(input.bridge, ['size']) && SIZE_VALUE_PATTERN.test(value)
      ? FAMILIES.wear_size
      : null;
  }
  if (['live', 'lives', 'reside', 'resides', 'move', 'moved'].includes(input.relation)) {
    return input.bridge.length === 0 ||
      ['at', 'in', 'to', 'à', 'en', 'em'].some((unit) => tokensMatch(input.bridge, [unit]))
      ? FAMILIES.residence
      : null;
  }
  if (['speak', 'speaks'].includes(input.relation)) {
    return input.bridge.length === 0 ? FAMILIES.spoken_language : null;
  }
  if (['use', 'uses'].includes(input.relation)) {
    return input.bridge.length === 0 ? FAMILIES.tool_usage : null;
  }
  if (['work', 'works'].includes(input.relation)) {
    return input.bridge.length === 0 ||
      ['as', 'als', 'comme', 'como'].some((unit) => tokensMatch(input.bridge, [unit])) ||
      tokensMatch(input.bridge, ['as', 'a']) ||
      tokensMatch(input.bridge, ['as', 'an'])
      ? FAMILIES.work
      : null;
  }
  return null;
}

function predicateMatchesFamily(input: {
  family: SelfRelationFamily;
  predicate: string;
  value: string;
  sourceUnits: readonly string[];
  sourceRelation: string;
}): boolean {
  const rawUnits = lexicalUnits(input.predicate);
  const valueForms = new Set(
    lexicalUnits(input.value).flatMap((unit) => Array.from(morphologicalForms(unit))),
  );
  const responseAliasActive = Array.from(valueForms).some((unit) =>
    ANSWER_RESPONSE_ALIASES.has(unit),
  );
  const durationAliasActive = Array.from(valueForms).some((unit) => DURATION_VALUE_UNITS.has(unit));
  const sourceRelationForms = morphologicalForms(input.sourceRelation);
  const sourceForms = new Set(
    [...input.sourceUnits, input.sourceRelation].flatMap((unit) =>
      Array.from(morphologicalForms(unit)),
    ),
  );
  // A provider key must carry a stable code-owned family property. The words
  // copied from this utterance's relation or value may describe the sentence,
  // but cannot establish correction/replacement identity on their own.
  const isSemanticAnchor = (form: string) => {
    if (GENERIC_PREDICATE_UNITS.has(form)) return false;
    const canonicalForm = SELF_RELATION_OPERATIONS[form] ?? form;
    return (
      input.family.predicateAnchors.has(canonicalForm) ||
      (durationAliasActive && DURATION_PREDICATE_ALIASES.has(canonicalForm))
    );
  };
  const isAllowed = (unit: string) => {
    const forms = morphologicalForms(unit);
    return Array.from(forms).some(
      (form) =>
        GENERIC_PREDICATE_UNITS.has(form) ||
        input.family.predicateVocabulary.has(form) ||
        valueForms.has(form) ||
        sourceForms.has(form) ||
        (responseAliasActive && ANSWER_RESPONSE_ALIASES.has(form)) ||
        (durationAliasActive && DURATION_PREDICATE_ALIASES.has(form)),
    );
  };
  return (
    rawUnits.length > 0 &&
    rawUnits.length <= 7 &&
    rawUnits.some((unit) => {
      const forms = Array.from(morphologicalForms(unit));
      return (
        !forms.some((form) => sourceRelationForms.has(form) || valueForms.has(form)) &&
        forms.some((form) => isSemanticAnchor(form))
      );
    }) &&
    rawUnits.every(isAllowed)
  );
}

export function isTrustedSelfRelationSurface(value: string): boolean {
  return SELF_RELATION_SURFACES.has(value.toLocaleLowerCase()) || isExactAgeRelationSurface(value);
}

export function isTrustedSelfRelationContraction(value: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(
      SELF_RELATION_CONTRACTION_OPERATIONS,
      value.toLocaleLowerCase(),
    ) || isExactAgeImplicitSelfRelation(value)
  );
}

export interface ExactSelfRelationMatch {
  relationIndex: number;
  durableSuffixBoundary: number;
}

export function matchExactSelfRelation(input: {
  text: string;
  tokens: readonly ExactSelfRelationToken[];
  subjectIndex: number;
  relationIndex: number;
  firstValueIndex: number;
  value: string;
  valueStart: number;
  valueEnd: number;
  predicate: string;
}): ExactSelfRelationMatch | null {
  const ageMatch = matchExactAgePhrase(input);
  if (ageMatch) {
    return predicateMatchesFamily({
      family: FAMILIES.age,
      predicate: input.predicate,
      value: input.value,
      sourceRelation: input.tokens[input.relationIndex]!.lower,
      sourceUnits: [],
    })
      ? { relationIndex: input.relationIndex, ...ageMatch }
      : null;
  }
  const relation = input.tokens[input.relationIndex];
  if (!relation || relation.quoted || !SELF_RELATION_SURFACES.has(relation.lower)) return null;
  const subject = input.tokens[input.subjectIndex];
  if (!subject || subject.quoted) return null;
  const operation = SELF_RELATION_OPERATIONS[relation.lower] ?? relation.lower;
  if (
    operation === 'am' &&
    !(
      (input.subjectIndex === input.relationIndex &&
        SELF_RELATION_CONTRACTION_OPERATIONS[relation.lower] === 'am') ||
      (input.subjectIndex < input.relationIndex &&
        EXACT_COPULA_BY_SUBJECT[subject.lower] === relation.lower)
    )
  ) {
    return null;
  }
  const leading = input.tokens.slice(input.subjectIndex + 1, input.relationIndex);
  if (
    !leading.every(
      (token) =>
        (operation === 'born' && token.lower === 'was') ||
        SELF_RELATION_LEADING_MODIFIERS.has(token.lower),
    )
  ) {
    return null;
  }
  const bridge = input.tokens.slice(input.relationIndex + 1, input.firstValueIndex);
  if (bridge.some((token) => token.quoted)) return null;
  const family = classifyFamily({
    relation: operation,
    sourceRelation: relation.lower,
    bridge,
    value: input.value,
  });
  if (
    !family ||
    !predicateMatchesFamily({
      family,
      predicate: input.predicate,
      value: input.value,
      sourceRelation: relation.lower,
      sourceUnits: bridge
        .filter(
          (token) =>
            ![
              'a',
              'an',
              'as',
              'at',
              'by',
              'in',
              'near',
              'on',
              'to',
              'up',
              'via',
              'à',
              'als',
              'comme',
              'como',
              'em',
              'en',
            ].includes(token.lower),
        )
        .map((token) => token.lower),
    })
  ) {
    return null;
  }
  return { relationIndex: input.relationIndex, durableSuffixBoundary: input.valueEnd };
}
