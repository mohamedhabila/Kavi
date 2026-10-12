import {
  omitNullsTheSchemaRejects,
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
  return JSON.parse(omitNullsTheSchemaRejects(JSON.stringify(args), SCHEMA));
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
    expect(omitNullsTheSchemaRejects(untouched, SCHEMA)).toBe(untouched);
    expect(omitNullsTheSchemaRejects('{"title":', SCHEMA)).toBe('{"title":');
    expect(omitNullsTheSchemaRejects('[null]', SCHEMA)).toBe('[null]');
    expect(omitNullsTheSchemaRejects('{"count":null}', undefined)).toBe('{"count":null}');
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
