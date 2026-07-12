export interface ExactPropertyPredicateToken {
  value: string;
  lower: string;
}

function lexicalUnitVariants(value: string): string[][] {
  const normalized = value.normalize('NFKC');
  const separated = normalized.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2');
  return [normalized, separated].map((source) =>
    Array.from(
      source.toLocaleLowerCase().matchAll(/[\p{L}\p{M}\p{N}]+/gu),
      (match) => match[0],
    ).filter((unit) => unit !== 's'),
  );
}

function lexicalUnits(value: string): string[] {
  return Array.from(new Set(lexicalUnitVariants(value).flat()));
}

function conservativeForms(value: string): Set<string> {
  const forms = new Set([value]);
  if (value.length > 3 && value.endsWith('s')) forms.add(value.slice(0, -1));
  if (value.length > 4 && value.endsWith('es')) forms.add(value.slice(0, -2));
  if (value.length > 4 && value.endsWith('ies')) forms.add(`${value.slice(0, -3)}y`);
  if (value.length > 4 && value.endsWith('en')) forms.add(value.slice(0, -2));
  if (value.length > 4 && value.endsWith('e')) forms.add(value.slice(0, -1));
  return forms;
}

export function predicateCoversExactPropertyDescriptor(
  predicate: string,
  descriptor: string,
): boolean {
  const predicateUnits = lexicalUnits(predicate);
  return lexicalUnitVariants(descriptor).some(
    (descriptorUnits) =>
      descriptorUnits.length > 0 &&
      descriptorUnits.every((unit) =>
        predicateUnits.some((candidate) =>
          Array.from(conservativeForms(unit)).some((form) =>
            conservativeForms(candidate).has(form),
          ),
        ),
      ),
  );
}

const GENERIC_UNITS = new Set('a an be for has have is my of self the user'.split(' '));
const HEAD_EXPANSIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  duration: new Set(['keep', 'keeps', 'length', 'time', 'timeout']),
  length: new Set(['duration', 'keep', 'keeps', 'time', 'timeout']),
  name: new Set(['display', 'preferred']),
  title: new Set(['display', 'preferred']),
  time: new Set(['duration', 'keep', 'keeps', 'length', 'timeout']),
  timeout: new Set(['duration', 'keep', 'keeps', 'length', 'time']),
};
const MODIFIER_ALIAS_GROUPS: readonly ReadonlySet<string>[] = [
  new Set(
    'actual actuel actuelle aktuell aktuelle actual atual current currently huidig huidige'.split(
      ' ',
    ),
  ),
  new Set('default standaard défaut standard predeterminado padrão'.split(' ')),
  new Set(
    'favorite favourite preferred favoriet favoriete voorkeur favori favorite préféré préférée bevorzugt bevorzugte bevorzugter bevorzugtes favorito favorita preferido preferida'.split(
      ' ',
    ),
  ),
  new Set(
    'usual gebruikelijk gebruikelijke habituel habituelle üblich übliche habitual keep keeps'.split(
      ' ',
    ),
  ),
  new Set(['primary']),
];
const NON_SEMANTIC_SOURCE_UNITS = new Set(
  'a actually am an are as at be ben bent change correction currently désormais est for forward from general going has have in is make mets mettez mijn mon ma mes my note notez now on please remember retenez self set that the to update user usual voortaan zet'.split(
    ' ',
  ),
);

function unitMatches(unit: string, targetUnits: ReadonlySet<string>): boolean {
  return Array.from(conservativeForms(unit)).some((form) => targetUnits.has(form));
}

export function predicateHasOnlyExactPropertyTargetSemantics(input: {
  predicate: string;
  target: readonly ExactPropertyPredicateToken[];
  source: readonly ExactPropertyPredicateToken[];
  head: ExactPropertyPredicateToken;
  isNominalModifier: (value: string) => boolean;
}): boolean {
  const predicateUnits = lexicalUnits(input.predicate);
  const targetUnits = new Set(
    input.target.flatMap((token) =>
      lexicalUnits(token.value).flatMap((unit) => Array.from(conservativeForms(unit))),
    ),
  );
  const sourceUnits = new Set(
    input.source.flatMap((token) =>
      lexicalUnits(token.value).flatMap((unit) =>
        NON_SEMANTIC_SOURCE_UNITS.has(unit) ? [] : Array.from(conservativeForms(unit)),
      ),
    ),
  );
  const headExpansions = HEAD_EXPANSIONS[input.head.lower] ?? new Set();
  const hasEveryModifier = input.target
    .filter((token) => input.isNominalModifier(token.lower))
    .every((token) => {
      const aliases =
        MODIFIER_ALIAS_GROUPS.find((group) => group.has(token.lower)) ?? new Set([token.lower]);
      return predicateUnits.some((unit) => aliases.has(unit));
    });
  return (
    hasEveryModifier &&
    predicateUnits.every(
      (unit) =>
        GENERIC_UNITS.has(unit) ||
        unitMatches(unit, targetUnits) ||
        unitMatches(unit, sourceUnits) ||
        headExpansions.has(unit),
    )
  );
}

export function predicateHasOnlyExactNamedPropertySemantics(input: {
  predicate: string;
  subject: string;
  target: readonly ExactPropertyPredicateToken[];
}): boolean {
  const subjectUnits = new Set(
    lexicalUnits(input.subject).flatMap((unit) => Array.from(conservativeForms(unit))),
  );
  const targetUnits = new Set(
    input.target.flatMap((token) =>
      lexicalUnits(token.value).flatMap((unit) => Array.from(conservativeForms(unit))),
    ),
  );
  return lexicalUnits(input.predicate).every(
    (unit) =>
      GENERIC_UNITS.has(unit) || unitMatches(unit, subjectUnits) || unitMatches(unit, targetUnits),
  );
}
