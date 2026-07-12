export const SUBJECT_SELF_MARKERS = new Set([
  'i',
  "i'm",
  'i’m',
  "i've",
  'i’ve',
  'ik',
  'je',
  "j'ai",
  'j’ai',
  'ich',
  'yo',
  'eu',
  'أنا',
  'انا',
  '私',
  'わたし',
  '僕',
  '俺',
  '我',
]);

export const POSSESSIVE_SELF_MARKERS = new Set([
  'my',
  'mine',
  'mijn',
  'mon',
  'ma',
  'mes',
  'mein',
  'meine',
  'mi',
  'mis',
  'meu',
  'minha',
  'لي',
  'عندي',
  'اسمي',
  '我的',
]);

export const OBJECT_SELF_MARKERS = new Set(['me', 'mij', 'moi', 'mich', 'mir']);

export const ALLOWED_SELF_RELATION_GAP = new Set([
  'am',
  'also',
  'always',
  'actually',
  'currently',
  'definitely',
  'do',
  'generally',
  'have',
  'just',
  'now',
  'personally',
  'really',
  'still',
  'typically',
  'usually',
  'want',
  'was',
  'would',
  'will',
]);

export const ALLOWED_POSSESSIVE_RELATION_GAP = new Set(
  'actual current default favorite favourite new preferred primary usual gebruikelijk gebruikelijke huidig huidige standaard favoriet favoriete habituel habituelle actuel actuelle défaut favori favorite préféré préférée üblich übliche aktuell aktuelle standard bevorzugt bevorzugte bevorzugter bevorzugtes habitual actual predeterminado favorito favorita preferido preferida atual padrão'.split(
    ' ',
  ),
);

export const ATTRIBUTION_MARKERS = new Set(
  'according claimed claims noted notes quoted quotes said says stated states told wrote writes'.split(
    ' ',
  ),
);

export const NEGATION_MARKERS = new Set(
  "cannot can't cant didnt didn't doesnt doesn't dont don't geen never niet no not nunca pas kein keine nicht لا لم لن ليس 不 没".split(
    ' ',
  ),
);

export const RESET_MARKERS = new Set(['but', 'however', 'instead', 'maar', 'aber', 'pero', 'mas']);

export const HYPOTHETICAL_MARKERS = new Set(
  'assuming could except if maybe may might perhaps possibly provided should suppose supposing unless would als misschien zou si pourrait'.split(
    ' ',
  ),
);

export const ALLOWED_NAMED_SUBJECT_RELATION_GAP = new Set([
  'a',
  'actually',
  'also',
  'always',
  'an',
  'are',
  'currently',
  'definitely',
  'generally',
  'has',
  'have',
  'is',
  'now',
  'really',
  'so',
  'still',
  'the',
  'typically',
  'usually',
]);

export const PREDICATE_STOP_UNITS = new Set('a an at be has have in is of on the to'.split(' '));

export const RELATION_ALIASES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['address', 'city', 'home', 'live', 'location', 'move', 'residence', 'reside']),
  new Set(['call', 'called', 'name', 'named']),
  new Set([
    'duration',
    'length',
    'time',
    'duur',
    'lengte',
    'tijd',
    'durée',
    'longueur',
    'temps',
    'dauer',
    'länge',
    'zeit',
    'duración',
    'longitud',
    'tiempo',
    'duração',
    'comprimento',
  ]),
  new Set([
    'channel',
    'contact',
    'default',
    'favorite',
    'favourite',
    'generally',
    'keep',
    'keeps',
    'normally',
    'prefer',
    'preference',
    'typical',
    'typically',
    'usual',
    'usually',
  ]),
  new Set(['job', 'occupation', 'profession', 'role', 'work']),
  new Set(['timezone', 'tz']),
];
