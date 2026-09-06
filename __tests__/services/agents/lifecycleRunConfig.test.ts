import { buildSubAgentSystemPrompt } from '../../../src/services/agents/lifecycle/runConfig';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

describe('buildSubAgentSystemPrompt', () => {
  it('preserves a short custom system prompt verbatim', () => {
    const prompt = buildSubAgentSystemPrompt(
      { systemPrompt: 'Custom worker prompt.', agentRunId: 'run-1' },
      0,
    );
    expect(prompt).toContain('Custom worker prompt.');
  });

  it('never splits a grapheme cluster when the 50,000-char system-prompt cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      const systemPrompt = `${'s'.repeat(49_990)}${probe.repeat(15)}`;
      const prompt = buildSubAgentSystemPrompt({ systemPrompt, agentRunId: 'run-1' }, 0);
      expectGraphemeSafe(prompt);
    }
  });
});
