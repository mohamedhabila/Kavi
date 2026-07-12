import type { StructuredNumericValueKind } from './exactFactValueSource';

const STRUCTURED_NUMERIC_PROPERTY_KINDS: Readonly<Record<string, StructuredNumericValueKind>> = {
  address: 'address',
  adresse: 'address',
  adres: 'address',
  dirección: 'address',
  endereço: 'address',
  certification: 'standard',
  standard: 'standard',
  code: 'identifier',
  handle: 'identifier',
  id: 'identifier',
  identifier: 'identifier',
  name: 'identifier',
  naam: 'identifier',
  nom: 'identifier',
  nombre: 'identifier',
  nome: 'identifier',
  number: 'identifier',
  nummer: 'identifier',
  numéro: 'identifier',
  número: 'identifier',
  title: 'identifier',
  titel: 'identifier',
  titre: 'identifier',
  título: 'identifier',
  token: 'identifier',
  username: 'identifier',
  contact: 'contact',
  contacto: 'contact',
  contato: 'contact',
  kontakt: 'contact',
  phone: 'phone',
  version: 'version',
};

export function exactPropertyHeadStructuredNumericKind(token: {
  lower: string;
}): StructuredNumericValueKind | undefined {
  return STRUCTURED_NUMERIC_PROPERTY_KINDS[token.lower];
}

export function exactPropertyTargetStructuredNumericKind(
  tokens: readonly { lower: string }[],
  subjectIndex: number,
  headIndex: number,
): StructuredNumericValueKind | undefined {
  const head = tokens[headIndex];
  if (!head) return undefined;
  const descriptors = tokens.slice(subjectIndex + 1, headIndex).map((token) => token.lower);
  if (
    ['number', 'nummer', 'numéro', 'número'].includes(head.lower) &&
    descriptors.includes('phone')
  ) {
    return 'phone';
  }
  return exactPropertyHeadStructuredNumericKind(head);
}
