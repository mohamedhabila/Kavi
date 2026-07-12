const NATIONALITY_IDENTITIES = new Set(
  'american australian austrian belgian brazilian british canadian chinese danish dutch egyptian finnish french german greek indian indonesian irish italian japanese mexican moroccan norwegian pakistani polish portuguese romanian russian spanish swedish swiss turkish ukrainian nederlands nederlandse français française deutsch deutsche deutscher español española português portuguesa'.split(
    ' ',
  ),
);

const MARITAL_STATUSES = new Set(
  'single married divorced widowed ongehuwd getrouwd weduwe weduwnaar célibataire marié mariée divorcé divorcée veuf veuve ledig verheiratet geschieden verwitwet soltero soltera casado casada divorciado divorciada viudo viuda solteiro solteira divorciado divorciada viúvo viúva'.split(
    ' ',
  ),
);

const PET_NOUN_PHRASES = new Set(['cat', 'dog', 'guinea pig', 'hamster', 'parrot', 'rabbit']);

const BEVERAGE_PHRASES = new Set([
  'black coffee',
  'black tea',
  'cappuccino',
  'coffee',
  'decaf coffee',
  'espresso',
  'green tea',
  'herbal tea',
  'hot chocolate',
  'iced coffee',
  'iced tea',
  'latte',
  'sparkling water',
  'still water',
  'tea',
  'water',
  'white tea',
]);
const COMMON_PREDICATE_FAMILY_ANCHORS: readonly ReadonlySet<string>[] = [
  new Set(['beverage', 'drink']),
  new Set(['marital', 'marriage']),
  new Set(['citizen', 'citizenship', 'national', 'nationality']),
  new Set(['pet']),
];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/gu, ' ');
}

function predicateUnitForms(value: string): Set<string> {
  const forms = new Set([value]);
  if (value.length > 3 && value.endsWith('s')) forms.add(value.slice(0, -1));
  if (value.length > 4 && value.endsWith('es')) forms.add(value.slice(0, -2));
  if (value.length > 4 && value.endsWith('ies')) forms.add(`${value.slice(0, -3)}y`);
  return forms;
}

export function isExactNationalityIdentity(value: string): boolean {
  return NATIONALITY_IDENTITIES.has(normalize(value));
}

export function isExactMaritalStatus(value: string): boolean {
  return MARITAL_STATUSES.has(normalize(value));
}

export function isExactPetOwnershipValue(value: string): boolean {
  const normalized = normalize(value).replace(/^(?:a|an)\s+/u, '');
  return PET_NOUN_PHRASES.has(normalized);
}

export function isExactBeveragePreferenceValue(value: string): boolean {
  return BEVERAGE_PHRASES.has(normalize(value));
}

export function hasUnambiguousExactCommonSelfPredicate(predicate: string): boolean {
  const units = new Set(
    Array.from(
      predicate
        .normalize('NFKC')
        .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
        .toLocaleLowerCase()
        .matchAll(/[\p{L}\p{M}\p{N}]+/gu),
      (match) => match[0],
    ),
  );
  return (
    COMMON_PREDICATE_FAMILY_ANCHORS.filter((anchors) =>
      Array.from(units).some((unit) =>
        Array.from(predicateUnitForms(unit)).some((form) => anchors.has(form)),
      ),
    ).length <= 1
  );
}
