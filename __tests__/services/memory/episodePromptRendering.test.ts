import { renderEpisodePromptSection } from '../../../src/services/memory/episodes/promptRendering';
import type { EpisodeRecallSelection } from '../../../src/services/memory/episodes/accessPolicyTypes';
import type { MemoryEpisode } from '../../../src/services/memory/episodes/types';
import {
  DEVANAGARI_COMBINING_TEXT,
  SURROGATE_PAIR_EMOJI,
  ZWJ_FAMILY_EMOJI,
  expectGraphemeSafe,
} from '../../helpers/graphemeSafetyProbes';

function makeEpisode(overrides: Partial<MemoryEpisode> = {}): MemoryEpisode {
  return {
    id: 'ep-1',
    conversationId: 'conv-1',
    threadId: 'conv-1',
    taskId: null,
    startedAt: 1,
    endedAt: 2,
    summary: 'User asked to fix the config file.',
    sensitivity: 'normal',
    entities: ['user'],
    messageIds: ['m1', 'm2'],
    toolNames: ['read_file'],
    importance: 0.7,
    localSimilarity: null,
    createdAt: 2,
    deletedAt: null,
    ...overrides,
  };
}

function makeEpisodeSelection(overrides: Partial<MemoryEpisode> = {}): EpisodeRecallSelection {
  const episode = makeEpisode(overrides);
  return {
    episode,
    lane: 'current_thread',
    authorizedOrigin: {
      memoryOwnerId: 'owner-1',
      memoryConversationId: episode.conversationId!,
      sourceThreadId: episode.threadId!,
      personaId: 'default',
      taskId: episode.taskId,
      policyVersion: 1,
    },
    policyExpiresAt: null,
    accessDecision: { authorized: true, reason: 'eligible' },
    relevanceScore: 1,
  } as EpisodeRecallSelection;
}

describe('renderEpisodePromptSection summary fitting', () => {
  it('renders a short summary verbatim', () => {
    const section = renderEpisodePromptSection([makeEpisodeSelection()]);
    expect(section).toContain('User asked to fix the config file.');
  });

  it('never splits a grapheme cluster when the 200-char summary cut lands inside a probe', () => {
    const probes = [SURROGATE_PAIR_EMOJI, ZWJ_FAMILY_EMOJI, DEVANAGARI_COMBINING_TEXT];
    for (const probe of probes) {
      // Repeat the probe near the 200-char cut boundary of MAX_RENDERED_EPISODE_SUMMARY_CHARS.
      const summary = `${'s'.repeat(190)}${probe.repeat(15)}`;
      const section = renderEpisodePromptSection([makeEpisodeSelection({ summary })]);
      expect(section).not.toBe('');
      expectGraphemeSafe(section as string);
    }
  });
});
