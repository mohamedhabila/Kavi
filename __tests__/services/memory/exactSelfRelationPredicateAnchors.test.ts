import { deriveExactSelfClaimEvidence } from '../../../src/services/memory/exactSelfClaimEvidence';

it.each([
  ['I live in Utrecht.', 'residence', 'Utrecht'],
  ['I speak Arabic.', 'spoken_language', 'Arabic'],
  ['I use VS Code.', 'tool_usage', 'VS Code'],
  ['I work as a software engineer.', 'occupation', 'software engineer'],
  ['I own a Tesla.', 'ownership', 'Tesla'],
  ['I have two children.', 'dependent_count', 'two children'],
  ['I commute by bike.', 'commute_method', 'bike'],
  ['I wear size 42.', 'wear_size', '42'],
])('admits a stable family-property predicate: %s', (message, predicate, value) => {
  expect(
    deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
  ).toMatchObject({
    predicate,
    value,
  });
});

it.each([
  ["I'm 42.", 'age', '42'],
  ['I’m a software engineer.', 'occupation', 'software engineer'],
  ["I've two children.", 'dependent_count', 'two children'],
])(
  'admits a stable family predicate through a common self contraction: %s',
  (message, predicate, value) => {
    expect(
      deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
    ).toMatchObject({
      predicate,
      value,
    });
  },
);

it.each([
  ['I am 42.', 'am', '42'],
  ['I am 42.', 'am_42', '42'],
  ['I am 42.', '42_am', '42'],
  ['I am vegetarian.', 'am', 'vegetarian'],
  ['I am a software engineer.', 'am', 'software engineer'],
  ['I have two children.', 'have_two_children', 'two children'],
  ['I wear size 42.', 'wear_42', '42'],
  ['I commute by bike.', 'commute_bike', 'bike'],
  ['I own a Tesla.', 'own_tesla', 'Tesla'],
  ['I own a Tesla.', 'owns_tesla', 'Tesla'],
  ['I own a Tesla.', 'tesla_owns', 'Tesla'],
  ["I'm 42.", 'am_42', '42'],
  ["I've two children.", 'have_two_children', 'two children'],
])(
  'rejects a predicate whose only apparent anchors come from source or value: %s / %s',
  (message, predicate, value) => {
    expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
  },
);
