import {
  decodeToolArgumentsAgainstSchema,
  strictifyOpenAiSchema,
} from '../../../../src/services/llm/core/schemaTransforms';

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    count: { type: 'number' },
    clearable: { type: ['string', 'null'] },
    mode: { type: 'string', enum: ['a', 'b', null] },
    either: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    anything: { description: 'Any JSON value.' },
    when: {
      type: 'object',
      properties: { kind: { type: 'string' }, at: { type: 'string' } },
      required: ['kind'],
    },
    steps: {
      type: 'array',
      items: { type: 'object', properties: { note: { type: 'string' } } },
    },
    schedule: {
      anyOf: [
        { type: 'string' },
        { type: 'object', properties: { kind: { type: 'string' }, tz: { type: 'string' } } },
      ],
    },
  },
  required: ['title'],
};

function decoded(args: unknown): unknown {
  return JSON.parse(decodeToolArgumentsAgainstSchema(JSON.stringify(args), SCHEMA));
}

describe('reading strict-form tool arguments', () => {
  it('drops the nulls a strict schema adds for optional properties, at any depth', () => {
    expect(
      decoded({
        title: 'Stretch',
        count: null,
        when: { kind: 'once', at: null },
        steps: [{ note: null }, { note: 'keep' }],
        schedule: { kind: 'cron', tz: null },
      }),
    ).toEqual({
      title: 'Stretch',
      when: { kind: 'once' },
      steps: [{}, { note: 'keep' }],
      schedule: { kind: 'cron' },
    });
  });

  it('keeps a null the tool schema itself admits, and any property it does not declare', () => {
    const args = {
      title: 'Stretch',
      clearable: null,
      mode: null,
      either: null,
      anything: null,
      undeclared: null,
    };

    expect(decoded(args)).toEqual(args);
  });

  it('drops a null for a required property, leaving it missing for validation to report', () => {
    expect(decoded({ title: null })).toEqual({});
  });

  it('returns text it has nothing to do with unchanged', () => {
    const untouched = '{ "title": "Stretch" }';
    expect(decodeToolArgumentsAgainstSchema(untouched, SCHEMA)).toBe(untouched);
    expect(decodeToolArgumentsAgainstSchema('{"title":', SCHEMA)).toBe('{"title":');
    expect(decodeToolArgumentsAgainstSchema('[null]', SCHEMA)).toBe('[null]');
    expect(decodeToolArgumentsAgainstSchema('{"count":null}', undefined)).toBe('{"count":null}');
  });

  it('undoes exactly what the strict form adds', () => {
    const strict = strictifyOpenAiSchema(SCHEMA);
    expect(strict.required).toEqual(Object.keys(SCHEMA.properties));
    const strictAnswer = {
      title: 'Stretch',
      count: null,
      clearable: null,
      mode: 'a',
      either: 'x',
      anything: 1,
      when: { kind: 'once', at: null },
      steps: null,
      schedule: null,
    };

    expect(decoded(strictAnswer)).toEqual({
      title: 'Stretch',
      clearable: null,
      mode: 'a',
      either: 'x',
      anything: 1,
      when: { kind: 'once' },
    });
  });
});

// A model calling a tool whose declaration it was not sent types every value as a string:
// Claude Sonnet 5.5 sent sms_compose `recipients` as '["+15550101001"]' and photos_pick
// `count` as "2".
describe('reading string-typed tool arguments', () => {
  const MEDIA_SCHEMA = {
    type: 'object',
    properties: {
      recipients: { type: 'array', items: { type: 'string' } },
      count: { type: 'number' },
      seconds: { type: 'integer' },
      loud: { type: 'boolean' },
      ids: { type: 'array', items: { type: 'number' } },
      when: { type: 'object', properties: { delaySeconds: { type: 'number' } } },
      label: { type: 'string' },
      either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      untyped: { description: 'Any JSON value.' },
    },
  };

  function read(args: unknown): unknown {
    return JSON.parse(decodeToolArgumentsAgainstSchema(JSON.stringify(args), MEDIA_SCHEMA));
  }

  it('decodes a string to the list, number, boolean or object the schema expects', () => {
    expect(
      read({
        recipients: '["+15550101001"]',
        count: '2',
        seconds: '3',
        loud: 'true',
        when: '{"delaySeconds":"60"}',
        ids: ['1', 2],
      }),
    ).toEqual({
      recipients: ['+15550101001'],
      count: 2,
      seconds: 3,
      loud: true,
      when: { delaySeconds: 60 },
      ids: [1, 2],
    });
  });

  it('never touches a position that admits a string, or states no type', () => {
    const args = { label: '2', either: '2', untyped: '[1]' };

    expect(read(args)).toEqual(args);
  });

  it('leaves a string that does not encode an admitted value for validation to report', () => {
    const args = { count: 'two', seconds: '3.5', recipients: '+15550101001', loud: 'null' };

    expect(read(args)).toEqual(args);
  });
});
