import { deriveExactSelfClaimEvidence } from '../../../src/services/memory/exactSelfClaimEvidence';

it.each([
  ["I'm 42.", 'age', '42'],
  ['I’m vegetarian.', 'dietary_identity', 'vegetarian'],
  ["I'm a software engineer.", 'occupation', 'software engineer'],
  ["I've got a dog.", 'pet_ownership', 'dog'],
  ['I’ve got a cat.', 'has_pet', 'cat'],
  ['Ik ben Nederlands.', 'nationality', 'Nederlands'],
  ['Je suis française.', 'nationality', 'française'],
  ['Ich bin Deutscher.', 'nationality', 'Deutscher'],
  ['Yo soy española.', 'nationality', 'española'],
  ['Eu sou portuguesa.', 'nationality', 'portuguesa'],
  ["I'm married.", 'marital_status', 'married'],
  ['Ik ben getrouwd.', 'marital_status', 'getrouwd'],
  ['Je suis mariée.', 'marital_status', 'mariée'],
  ['Ich bin verheiratet.', 'marital_status', 'verheiratet'],
  ['Yo soy casado.', 'marital_status', 'casado'],
  ['Eu sou casada.', 'marital_status', 'casada'],
  ['My nationality is Canadian.', 'nationality', 'Canadian'],
  ['My marital status is single.', 'marital_status', 'single'],
  ['I have a dog.', 'pet_ownership', 'dog'],
  ['I have a dog.', 'pet_ownership', 'a dog'],
  ['I own a parrot.', 'pet_ownership', 'parrot'],
  ['I prefer coffee.', 'drink_preference', 'coffee'],
  ['I like green tea.', 'favorite_drink', 'green tea'],
  ['My favorite drink is coffee.', 'favorite_drink', 'coffee'],
])('admits a closed common self fact: %s / %s', (message, predicate, value) => {
  expect(
    deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
  ).toMatchObject({
    predicate,
    value,
  });
});

it.each([
  ['Im 42.', 'age', '42'],
  ["I 'm 42.", 'age', '42'],
  ["I'm probably 42.", 'age', '42'],
  ["I'm not married.", 'marital_status', 'married'],
  ['I got a dog.', 'pet_ownership', 'dog'],
  ["I've got a hot dog.", 'pet_ownership', 'hot dog'],
  ["I've got a dog for this week.", 'pet_ownership', 'dog'],
  ['Je bin française.', 'nationality', 'française'],
  ['Ich soy Deutscher.', 'nationality', 'Deutscher'],
  ['Yo sou española.', 'nationality', 'española'],
  ['I are married.', 'marital_status', 'married'],
  ['I speak Dutch.', 'nationality', 'Dutch'],
  ['I live in Canada.', 'nationality', 'Canada'],
  ['I am Dutch.', 'spoken_language', 'Dutch'],
  ['I am a Dutch engineer.', 'nationality', 'Dutch engineer'],
  ['I am probably Dutch.', 'nationality', 'Dutch'],
  ['I am Dutch for this role.', 'nationality', 'Dutch'],
  ['I am engaged.', 'marital_status', 'engaged'],
  ['I am separated.', 'marital_status', 'separated'],
  ['I am Nigerian.', 'nationality', 'Nigerian'],
  ['I am Korean.', 'nationality', 'Korean'],
  ['I am Palestinian.', 'nationality', 'Palestinian'],
  ['I am in a civil partnership.', 'marital_status', 'civil partnership'],
  ['I am married.', 'employment_status', 'married'],
  ['I have a cold.', 'pet_ownership', 'cold'],
  ['I have dog allergies.', 'pet_ownership', 'dog allergies'],
  ['I have a dog in the photo.', 'pet_ownership', 'dog'],
  ['I have two children.', 'pet_ownership', 'two children'],
  ['I have a turtle.', 'pet_ownership', 'turtle'],
  ['I own a Tesla.', 'pet_ownership', 'Tesla'],
  ['I prefer concise answers.', 'drink_preference', 'concise answers'],
  ['I prefer Java.', 'drink_preference', 'Java'],
  ['I prefer matcha.', 'drink_preference', 'matcha'],
  ['I drink coffee.', 'drink_preference', 'coffee'],
  ['I prefer coffee for this meeting.', 'drink_preference', 'coffee'],
  ['I prefer coffee or tea.', 'drink_preference', 'coffee or tea'],
])(
  'rejects an unsafe or semantically confused common self fact: %s / %s',
  (message, predicate, value) => {
    expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
  },
);

it('does not treat every pet-prefixed property as an ownership fact', () => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: 'My pet name is Fido.',
      predicate: 'pet_name',
      value: 'Fido',
    }),
  ).toMatchObject({ predicate: 'pet_name', value: 'Fido' });
});

it.each([
  ['My nationality is Nigerian.', 'nationality', 'Nigerian'],
  ['My nationality is Korean.', 'nationality', 'Korean'],
  ['My nationality is Palestinian.', 'nationality', 'Palestinian'],
  ['My marital status is engaged.', 'marital_status', 'engaged'],
  ['My marital status is civil partnership.', 'marital_status', 'civil partnership'],
  ['My relationship status is civil partnership.', 'relationship_status', 'civil partnership'],
  ['My pet is a turtle.', 'pet', 'a turtle'],
  ['My favorite drink is matcha.', 'favorite_drink', 'matcha'],
])(
  'admits an open value through an exact explicit property: %s / %s',
  (message, predicate, value) => {
    expect(
      deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
    ).toMatchObject({ predicate, value });
  },
);

it.each(['drink_nationality', 'drinks_nationality'])(
  'rejects a provider predicate that launders an unrelated common property family: %s',
  (predicate) => {
    expect(
      deriveExactSelfClaimEvidence({
        userMessageText: 'My nationality is Canadian.',
        predicate,
        value: 'Canadian',
      }),
    ).toBeNull();
  },
);
