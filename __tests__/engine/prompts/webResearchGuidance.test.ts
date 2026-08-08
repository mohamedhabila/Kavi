import { buildRuntimePromptSection } from '../../../src/engine/prompts/orchestratorPromptSections';

// Traced on-device. `web_search` is gated on a configured provider and is correctly
// dropped from the tool surface when there is none — but the runtime guidance named it
// unconditionally. The model was told to search, called a tool it had never been given,
// and the call failed; every research request opened with a failed `web_search` and a
// `tool_catalog` round-trip before falling back to `web_fetch`, the only usable path.
describe('web research guidance follows the tools actually on the surface', () => {
  it('names web_search when a provider is configured', () => {
    const section = buildRuntimePromptSection({
      toolExecutionAvailable: true,
      webSearchAvailable: true,
    });

    expect(section).toContain('web_search discovers and web_fetch reads');
  });

  it('never names web_search when no provider is configured', () => {
    const section = buildRuntimePromptSection({
      toolExecutionAvailable: true,
      webSearchAvailable: false,
    });

    expect(section).not.toContain('web_search discovers');
    expect(section).toContain('web_fetch');
  });

  it('points at the fallback rather than merely omitting the tool', () => {
    const section = buildRuntimePromptSection({
      toolExecutionAvailable: true,
      webSearchAvailable: false,
    });

    // Silence would leave the model to guess; the line has to say what to use instead.
    expect(section).toMatch(/no search provider is configured/i);
    expect(section).toMatch(/reach pages directly with web_fetch/i);
  });

  it('keeps the existing wording when availability is not stated', () => {
    const section = buildRuntimePromptSection({ toolExecutionAvailable: true });

    expect(section).toContain('web_search discovers and web_fetch reads');
  });

  it('emits no tool guidance at all when tools cannot run', () => {
    const section = buildRuntimePromptSection({
      toolExecutionAvailable: false,
      webSearchAvailable: false,
    });

    expect(section).not.toContain('web_fetch');
  });
});
