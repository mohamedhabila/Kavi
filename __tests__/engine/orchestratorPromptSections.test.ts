import {
  buildRuntimeContextNote,
  buildSystemPromptSections,
  getUserMessagePromptContent,
  joinSystemPromptSections,
  stripRuntimeContextFromUserContent,
} from '../../src/engine/prompts/orchestratorPromptSections';
import { splitCacheableSystemPromptSections } from '../../src/services/llm/core/systemPromptSections';

describe('orchestratorPromptSections', () => {
  it('sanitizes stale runtime context blocks out of user content', () => {
    const content = 'Please check this.\n\n<runtime_context>old</runtime_context>';

    expect(getUserMessagePromptContent({ content, enrichedContent: undefined })).toBe(
      'Please check this.',
    );
    expect(stripRuntimeContextFromUserContent(undefined)).toBe('');
  });

  it('builds full system prompts with cacheable policy before dynamic memory', () => {
    const runtimeContext = buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z'));
    const sections = buildSystemPromptSections(
      'Base prompt.',
      runtimeContext,
      'Conversation fact.',
      'Global fact.',
      '',
      '',
      true,
      false,
    );
    const prompt = joinSystemPromptSections(sections);

    expect(sections[0]).toMatchObject({ text: 'Base prompt.', cacheable: true });
    expect(prompt).toContain('Conversation memory:');
    expect(prompt).toContain('Runtime: mobile (React Native / Expo), channel mobile-app.');
    expect(prompt).toContain('Runtime context:');
    expect(prompt).toContain('When provider tools are supplied for the turn');
    expect(prompt).toContain(
      'Prefer the highest-leverage tool that directly fits the next work unit. If a worker can finish from its prompt',
    );
    expect(prompt).toContain(
      'Verification, search, listing, reading, or memory recall is not completion when the same turn also asks you to write',
    );
    expect(prompt).toContain(
      'Fetch known URLs directly',
    );
    expect(prompt).toContain('batch independent fetches');
    expect(prompt).not.toContain('site:host');
    expect(prompt).not.toContain('one broad query and one reference-oriented query');
    expect(prompt).toContain(
      'compare sources separately',
    );
    expect(prompt).toContain(
      're-search only when fetched pages are insufficient',
    );
    expect(prompt).toContain("Safety: no independent goals beyond the user's request.");
    expect(prompt).not.toContain('## Tool Call Style');
  });

  it('keeps graph-owned turns on runtime guidance instead of a second tool-style policy block', () => {
    const sections = buildSystemPromptSections(
      'Base prompt.',
      buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z')),
      null,
      null,
      '',
      '',
      true,
      false,
    );
    const prompt = joinSystemPromptSections(sections);

    expect(prompt).toContain('Runtime: mobile (React Native / Expo), channel mobile-app.');
    expect(prompt).not.toContain('## Tool Call Style');
    expect(prompt).not.toContain('This is a graph-owned execution turn.');
    expect(prompt).not.toContain('## Agent Mode');
  });

  it('keeps text-only turns on the same cacheable runtime baseline with dynamic mode limits', () => {
    const sections = buildSystemPromptSections(
      'Base prompt.',
      buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z')),
      null,
      null,
      'Available skills:\n- Weather: skills/managed/weather/SKILL.md',
      '',
      true,
      true,
    );
    const prompt = joinSystemPromptSections(sections);

    expect(prompt).toContain('Runtime: mobile (React Native / Expo), channel mobile-app.');
    expect(prompt).toContain('When provider tools are supplied for the turn');
    expect(prompt).toContain('For web research, use web_search');
    expect(prompt).toContain('Execution mode for this turn: no registered executable tools');
    expect(prompt).toContain('Available skills:');
    expect(prompt).toContain('Weather');
    expect(prompt).toContain("Safety: no independent goals beyond the user's request.");
  });

  it('keeps the cacheable baseline stable across per-turn execution modes', () => {
    const runtimeContext = buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z'));
    const toolCapable = buildSystemPromptSections(
      'Base prompt.',
      runtimeContext,
      null,
      null,
      '',
      '',
      true,
      false,
    );
    const textOnly = buildSystemPromptSections(
      'Base prompt.',
      runtimeContext,
      null,
      null,
      '',
      '',
      true,
      true,
    );
    const providerNoTools = buildSystemPromptSections(
      'Base prompt.',
      runtimeContext,
      null,
      null,
      '',
      '',
      false,
      false,
    );

    expect(splitCacheableSystemPromptSections(textOnly).cacheableText).toBe(
      splitCacheableSystemPromptSections(toolCapable).cacheableText,
    );
    expect(splitCacheableSystemPromptSections(providerNoTools).cacheableText).toBe(
      splitCacheableSystemPromptSections(toolCapable).cacheableText,
    );
    expect(splitCacheableSystemPromptSections(textOnly).dynamicText).toContain(
      'Execution mode for this turn: no registered executable tools',
    );
  });
});
