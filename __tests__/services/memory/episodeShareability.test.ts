import { resolveTurnEpisodeShareability } from '../../../src/services/memory/episodes/shareability';

describe('turn episode shareability', () => {
  it('shares ordinary chat episodes within one memory conversation', () => {
    expect(resolveTurnEpisodeShareability(null)).toBe('session_threads');
    expect(resolveTurnEpisodeShareability(undefined)).toBe('session_threads');
  });

  it('keeps task-bound episodes thread-local', () => {
    expect(resolveTurnEpisodeShareability('task-1')).toBe('thread_only');
  });
});
