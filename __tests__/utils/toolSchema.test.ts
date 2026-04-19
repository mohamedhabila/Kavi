import { normalizeToolInputSchema } from '../../src/utils/toolSchema';

describe('normalizeToolInputSchema', () => {
  it('preserves boolean and schema-valued additionalProperties on object nodes', () => {
    const schema = normalizeToolInputSchema({
      type: 'object',
      properties: {
        options: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
          },
          required: ['mode'],
          additionalProperties: false,
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      additionalProperties: false,
    });

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.options.additionalProperties).toBe(false);
    expect(schema.properties.headers.additionalProperties).toEqual({ type: 'string' });
  });

  it('flattens root oneOf object branches into a provider-safe object schema', () => {
    const schema = normalizeToolInputSchema({
      type: 'object',
      properties: {
        code: { type: 'string' },
        path: { type: 'string' },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      oneOf: [{ required: ['code'] }, { required: ['path'] }],
      required: [],
    });

    expect(schema.type).toBe('object');
    expect(schema.oneOf).toBeUndefined();
    expect(schema.anyOf).toBeUndefined();
    expect(schema.allOf).toBeUndefined();
    expect(schema.properties).toHaveProperty('code');
    expect(schema.properties).toHaveProperty('path');
    expect(schema.properties.env.additionalProperties).toEqual({ type: 'string' });
    expect(schema.required).toBeUndefined();
  });

  it('keeps only shared required keys from root anyOf object branches', () => {
    const schema = normalizeToolInputSchema({
      anyOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string' },
            mode: { type: 'string' },
          },
          required: ['id', 'mode'],
        },
        {
          type: 'object',
          properties: {
            id: { type: 'string' },
            value: { type: 'number' },
          },
          required: ['id', 'value'],
        },
      ],
    });

    expect(schema.required).toEqual(['id']);
    expect(Object.keys(schema.properties).sort()).toEqual(['id', 'mode', 'value']);
  });

  it('merges root allOf object branches and required keys', () => {
    const schema = normalizeToolInputSchema({
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            payload: { type: 'string' },
          },
          required: ['payload'],
        },
      ],
    });

    expect(schema.required).toEqual(expect.arrayContaining(['id', 'payload']));
    expect(schema.required).toHaveLength(2);
    expect(schema.additionalProperties).toBe(false);
  });

  it('canonicalizes non-object roots to an empty object schema', () => {
    const schema = normalizeToolInputSchema({
      type: 'array',
      items: { type: 'string' },
      title: 'Arguments',
    });

    expect(schema).toEqual({
      type: 'object',
      properties: {},
      title: 'Arguments',
    });
  });
});
