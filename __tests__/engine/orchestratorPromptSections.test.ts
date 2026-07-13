import {
  buildRuntimeContextNote,
  buildSystemPromptSections,
  DURABLE_MEMORY_ACKNOWLEDGEMENT_CONTRACT,
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

  it('builds full system prompts with cacheable policy before dynamic context', () => {
    const runtimeContext = buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z'));
    const sections = buildSystemPromptSections('Base prompt.', runtimeContext, '', '', true, false);
    const prompt = joinSystemPromptSections(sections);

    expect(sections[0]).toMatchObject({ text: 'Base prompt.', cacheable: true });
    expect(prompt).toContain('Runtime: mobile (React Native / Expo), channel mobile-app.');
    expect(prompt).toContain('Runtime context:');
    expect(prompt).toContain('With tools, batch independent calls and sequence only dependencies');
    expect(prompt).toContain('Use the highest-leverage tool. Launch a self-contained worker');
    expect(prompt).toContain(
      'Use external-state tools only when the requested answer or action requires live data',
    );
    expect(prompt).toContain(
      'mentioning a meeting, deadline, person, or schedule alone does not request inspection',
    );
    expect(prompt).toContain(DURABLE_MEMORY_ACKNOWLEDGEMENT_CONTRACT);
    expect(prompt).toContain('Without verified current-turn durable-memory write evidence');
    expect(prompt).toContain('never say it was remembered, saved, stored, or updated');
    expect(prompt).toContain('never promise to remember or save it');
    expect(prompt).not.toContain('Natural chitchat memory is recorded after the turn');
    expect(prompt).toContain(
      'Reading, search, recall, or verification is not completion when the request also requires action',
    );
    expect(prompt).toContain('Fetch known URLs directly');
    expect(prompt).toContain('batch independent fetches');
    expect(prompt).not.toContain('site:host');
    expect(prompt).not.toContain('one broad query and one reference-oriented query');
    expect(prompt).toContain('compare sources');
    expect(prompt).toContain('re-search only if needed');
    expect(prompt).toContain("Safety: no independent goals beyond the user's request.");
    expect(prompt).not.toContain('## Tool Call Style');
  });

  it('keeps graph-owned turns on runtime guidance instead of a second tool-style policy block', () => {
    const sections = buildSystemPromptSections(
      'Base prompt.',
      buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z')),
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

  it('keeps universal policy while omitting unusable tool guidance from text-only turns', () => {
    const sections = buildSystemPromptSections(
      'Base prompt.',
      buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z')),
      'Available skills:\n- Weather: skills/managed/weather/SKILL.md',
      '',
      true,
      true,
    );
    const prompt = joinSystemPromptSections(sections);

    expect(prompt).toContain('Runtime: mobile (React Native / Expo), channel mobile-app.');
    expect(prompt).toContain(
      'Use external-state tools only when the requested answer or action requires live data',
    );
    expect(prompt).toContain(DURABLE_MEMORY_ACKNOWLEDGEMENT_CONTRACT);
    expect(prompt).not.toContain('With tools, batch independent calls');
    expect(prompt).not.toContain('For web research, web_search discovers');
    expect(prompt).toContain('Execution mode for this turn: no registered executable tools');
    expect(prompt).toContain('Available skills:');
    expect(prompt).toContain('Weather');
    expect(prompt).toContain("Safety: no independent goals beyond the user's request.");
  });

  it('uses a smaller cacheable baseline when the turn cannot execute tools', () => {
    const runtimeContext = buildRuntimeContextNote(new Date('2026-05-29T10:00:00.000Z'));
    const toolCapable = buildSystemPromptSections(
      'Base prompt.',
      runtimeContext,
      '',
      '',
      true,
      false,
    );
    const textOnly = buildSystemPromptSections('Base prompt.', runtimeContext, '', '', true, true);
    const providerNoTools = buildSystemPromptSections(
      'Base prompt.',
      runtimeContext,
      '',
      '',
      false,
      false,
    );

    const toolCapableCacheable = splitCacheableSystemPromptSections(toolCapable).cacheableText;
    const textOnlyCacheable = splitCacheableSystemPromptSections(textOnly).cacheableText;
    const providerNoToolsCacheable =
      splitCacheableSystemPromptSections(providerNoTools).cacheableText;

    expect(textOnlyCacheable.length).toBeLessThan(toolCapableCacheable.length);
    expect(providerNoToolsCacheable).toBe(textOnlyCacheable);
    expect(textOnlyCacheable).toContain(DURABLE_MEMORY_ACKNOWLEDGEMENT_CONTRACT);
    expect(textOnlyCacheable).not.toContain('With tools, batch independent calls');
    expect(splitCacheableSystemPromptSections(textOnly).dynamicText).toContain(
      'Execution mode for this turn: no registered executable tools',
    );
  });
});
