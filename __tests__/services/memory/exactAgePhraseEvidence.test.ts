import { deriveExactSelfClaimEvidence } from '../../../src/services/memory/exactSelfClaimEvidence';

function ageClaim(userMessageText: string, value: string, predicate = 'age') {
  return deriveExactSelfClaimEvidence({ userMessageText, predicate, value });
}

it.each([
  ['I am 1 year old.', '1'],
  ['I am 42 years old.', '42'],
  ["I'm 42 years old.", '42'],
  ['I’m 42 years old.', '42'],
  ['Ik ben 1 jaar oud.', '1'],
  ['Ik ben 42 jaar oud.', '42'],
  ["J'ai 1 an.", '1'],
  ['J’ai 42 ans.', '42'],
  ['Ich bin 1 Jahr alt.', '1'],
  ['Ich bin 42 Jahre alt.', '42'],
  ['Yo tengo 1 año.', '1'],
  ['Tengo 42 años.', '42'],
  ['Eu tenho 1 ano.', '1'],
  ['Tenho 42 anos.', '42'],
  ['عمري 0 سنة.', '0'],
  ['عمري 1 سنة.', '1'],
  ['عمري 3 سنوات.', '3'],
  ['عمري 10 سنوات.', '10'],
  ['عمري 11 سنة.', '11'],
  ['عمري 42 سنة.', '42'],
  ['عمري 120 سنة.', '120'],
  ['私は42歳です。', '42'],
  ['私は120歳です。', '120'],
  ['我0岁。', '0'],
  ['我42岁。', '42'],
  ['我今年42岁。', '42'],
  ['我今年120岁。', '120'],
  ['I am 0 years old.', '0'],
  ['Ich bin 120 Jahre alt.', '120'],
])('admits one exact language-bound age phrase: %s', (message, value) => {
  expect(ageClaim(message, value)).toMatchObject({ predicate: 'age', value });
});

it.each([
  ['I am 42.', '42'],
  ["I'm 42.", '42'],
  ['I’m 42.', '42'],
  ['Ik ben 42.', '42'],
  ['Ich bin 42.', '42'],
])('keeps one exact code-owned bare age frame: %s', (message, value) => {
  expect(ageClaim(message, value)).toMatchObject({ predicate: 'age', value });
});

it.each([
  ['Je suis 42.', '42'],
  ['Yo soy 42.', '42'],
  ['Eu sou 42.', '42'],
])('rejects a bare copular number that is not an age construction: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it('consumes the age tail before evaluating the durable claim suffix', () => {
  expect(ageClaim('I am 42 years old going forward.', '42')).toMatchObject({
    predicate: 'age',
    value: '42',
  });
});

it.each([
  ['I am 1 years old.', '1'],
  ['I am 2 year old.', '2'],
  ["J'ai 1 ans.", '1'],
  ["J'ai 2 an.", '2'],
  ['Ich bin 1 Jahre alt.', '1'],
  ['Ich bin 2 Jahr alt.', '2'],
  ['Yo tengo 1 años.', '1'],
  ['Tengo 2 año.', '2'],
  ['Eu tenho 1 anos.', '1'],
  ['Tenho 2 ano.', '2'],
  ['عمري 2 سنة.', '2'],
  ['عمري 2 سنتان.', '2'],
  ['عمري 3 سنة.', '3'],
  ['عمري 11 سنوات.', '11'],
])('rejects a number/unit disagreement: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it.each([
  ['I am 42 jaar oud.', '42'],
  ['Ik ben 42 years old.', '42'],
  ["J'ai 42 Jahre alt.", '42'],
  ['Ich bin 42 años.', '42'],
  ['Yo tengo 42 anos.', '42'],
  ['Eu tenho 42 años.', '42'],
  ['I ben 42 jaar oud.', '42'],
  ['Ik am 42 years old.', '42'],
  ['Yo tenho 42 anos.', '42'],
  ['Eu tengo 42 años.', '42'],
  ['Je suis 42 ans.', '42'],
  ['Soy 42 años.', '42'],
  ['عمري 42 سنوات.', '42'],
  ['عمري 42 歳です.', '42'],
  ['私は42岁。', '42'],
  ['我42歳です。', '42'],
  ['私 は42歳です。', '42'],
  ['42歳です。', '42'],
  ['actually私は42歳です。', '42'],
  ['please我42岁。', '42'],
])('rejects a mixed or incomplete language frame: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it.each([
  ['I am around 42 years old.', '42'],
  ['I am probably 42 years old.', '42'],
  ['I am >42 years old.', '42'],
  ['I am 42-43 years old.', '42-43'],
  ['I am 42 to 43 years old.', '42 to 43'],
  ['I am 42ish years old.', '42ish'],
  ['I am 001 years old.', '001'],
  ['I am 121 years old.', '121'],
  ['I am -1 years old.', '-1'],
  ['I am 1.5 years old.', '1.5'],
  ['عمري حوالي 42 سنة.', '42'],
  ['عمري 42 إلى 43 سنة.', '42'],
  ['عمري 42-43 سنة.', '42-43'],
  ['私はたぶん42歳です。', '42'],
  ['私は42〜43歳です。', '42〜43'],
  ['私は121歳です。', '121'],
  ['我大概42岁。', '42'],
  ['我42至43岁。', '42'],
  ['我121岁。', '121'],
])('rejects an inexact or out-of-range age: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it.each([
  ['For this week, I am 42 years old.', '42'],
  ['Today, I am 42 years old.', '42'],
  ['I am 42 years old for this role.', '42'],
  ['I am 42 years old today.', '42'],
  ['I am 42 years old in the photo.', '42'],
  ['اليوم عمري 42 سنة.', '42'],
  ['عمري اليوم 42 سنة.', '42'],
  ['今日私は42歳です。', '42'],
  ['私は今日42歳です。', '42'],
  ['今天我42岁。', '42'],
  ['我今天42岁。', '42'],
  ['我目前42岁。', '42'],
])('rejects a temporary age scope: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it.each([
  ['"I am 42 years old."', '42'],
  ['I am "42" years old.', '42'],
  ['According to Sara, I am 42 years old.', '42'],
  ['Sara says I am 42 years old.', '42'],
  ['Sara is 42 years old.', '42'],
  ['“عمري 42 سنة.”', '42'],
  ['تقول سارة إن عمري 42 سنة.', '42'],
  ['「私は42歳です」', '42'],
  ['彼女は42歳です。', '42'],
  ['母によると私は42歳です。', '42'],
  ['母によると、私は42歳です。', '42'],
  ['“我42岁。”', '42'],
  ['她42岁。', '42'],
  ['妈妈说我42岁。', '42'],
  ['妈妈说，我42岁。', '42'],
])('rejects quoted, attributed, or third-party age prose: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it.each([
  ['I am 42 years young.', '42'],
  ['I am 42, years old.', '42'],
  ['I am 42 years old allegedly.', '42'],
  ['I am 42 years old for photos.', '42'],
  ["J'ai 42 ans environ.", '42'],
  ['Ich bin 42 Jahre ungefähr alt.', '42'],
  ['عمري 42 سنة تقريباً.', '42'],
  ['عمري 42 سنة؟', '42'],
  ['私は42歳ですか？', '42'],
  ['私は42歳です？', '42'],
  ['私は42歳ですたぶん。', '42'],
  ['私は42歳です、たぶん。', '42'],
  ['我42岁吗？', '42'],
  ['我42岁？', '42'],
  ['我42岁左右。', '42'],
  ['我42岁，左右。', '42'],
])('rejects punctuation, qualifiers, and arbitrary age tails: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it.each([
  ['I am 42 years old.', '42 years old'],
  ['Ik ben 42 jaar oud.', '42 jaar oud'],
  ["J'ai 42 ans.", '42 ans'],
  ['عمري 42 سنة.', '42 سنة'],
  ['私は42歳です。', '42歳です'],
  ['我42岁。', '42岁'],
])('keeps the language tail out of the provider value: %s', (message, value) => {
  expect(ageClaim(message, value)).toBeNull();
});

it.each([
  ['I am 42 years old.', 'occupation'],
  ['Ik ben 42 jaar oud.', 'private_secret'],
  ["J'ai 42 ans.", 'dependent_count'],
  ['Ich bin 42 Jahre alt.', 'wear_size'],
  ['Tengo 42 años.', 'residence'],
  ['Tenho 42 anos.', 'nationality'],
  ['عمري 42 سنة.', 'occupation'],
  ['私は42歳です。', 'wear_size'],
  ['我42岁。', 'dependent_count'],
  ['我今年42岁。', 'residence'],
])('rejects provider predicate relabeling: %s / %s', (message, predicate) => {
  expect(ageClaim(message, '42', predicate)).toBeNull();
});
