import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';
import { renderGoalBootstrapPromptSection } from '../../../src/engine/goals/bootstrap';
import {
  isStrictCompatibleSchema,
  strictifyOpenAiSchema,
} from '../../../src/services/llm/core/schemaTransforms';
import { normalizeToolInputSchema } from '../../../src/utils/toolSchema';

// Traced live on an Android emulator, by probing the exact schema sent to the provider.
// `update_goals` sets strict: true, and OpenAI strict function calling requires every
// property to appear in `required`, with optional ones expressed as a nullable type. So
// `strictifyOpenAiSchema` rewrites the schema into fourteen equally-required fields and
// `goals` becomes just another one of them, typed ["array","null"]. Nothing in the shape
// says `goals` is an alternative to the flat fields — they read as peers.
//
// That is why marking `goals` optional changed no behaviour: the model kept the shape it
// already knew and sent one goal per call, fifteen times. Under strict mode the free-text
// description and the prompt section are the only channels that survive intact, so the
// batched form has to be taught there rather than expressed structurally.

const strictSchema = (() => {
  const normalized = normalizeToolInputSchema(UPDATE_GOALS_TOOL.input_schema) as Record<
    string,
    unknown
  >;
  return isStrictCompatibleSchema(normalized) ? strictifyOpenAiSchema(normalized) : normalized;
})();

describe('the provider transform is why structure cannot carry this', () => {
  it('marks every property required, including goals', () => {
    const required = (strictSchema.required ?? []) as string[];

    expect(required).toContain('goals');
    // The flat fields are equally required, so optionality conveys nothing.
    expect(required).toEqual(expect.arrayContaining(['action', 'id', 'name', 'status']));
  });

  it('keeps goals reachable rather than dropping it', () => {
    const properties = strictSchema.properties as Record<string, { type?: unknown }>;
    expect(properties.goals).toBeDefined();
    expect(properties.goals.type).toEqual(expect.arrayContaining(['array']));
  });
});

describe('the batched form is taught where the model can still read it', () => {
  it('leads the tool description, which strict mode passes through untouched', () => {
    const described = (strictSchema.description as string) ?? UPDATE_GOALS_TOOL.description;

    expect(UPDATE_GOALS_TOOL.description).toContain('ONE call');
    expect(UPDATE_GOALS_TOOL.description).toContain('never one call per goal');
    // A concrete example, because the shape cannot show it.
    expect(UPDATE_GOALS_TOOL.description).toContain('"action":"add","goals":[');
    expect(UPDATE_GOALS_TOOL.description).toContain('"action":"complete","goals":[');
    expect(described).toBeTruthy();
  });

  it('accepts either null or omission, since strict mode is not always applied', () => {
    // strictifyOpenAiSchema runs only when isOpenAIProvider() is true, so a run served
    // through OpenRouter never sees the forced-required schema this file exercises.
    // Telling that run to send explicit nulls would be wrong, so the wording covers both.
    expect(UPDATE_GOALS_TOOL.description).toContain('sent as null or omitted');
  });

  it('spells out that goals holds objects, the shape the model actually got wrong', () => {
    expect(UPDATE_GOALS_TOOL.description).toContain('"goals":[{"id":"a"}]');
    expect(UPDATE_GOALS_TOOL.description).toContain('never "goals":["id":"a"]');
  });

  it('no longer tells the bootstrap prompt that a call carries one goal', () => {
    const section = renderGoalBootstrapPromptSection();

    expect(section).not.toContain('one goal mutation with root fields');
    expect(section).toContain('ONE call');
    expect(section).toContain('"action":"complete","goals":');
  });
});
