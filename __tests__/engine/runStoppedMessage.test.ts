import { buildRunStoppedMessage } from '../../src/engine/graph/runStoppedMessage';
import { i18n } from '../../src/i18n/manager';

afterEach(async () => {
  await i18n.setLocale('en');
});

describe('buildRunStoppedMessage', () => {
  it('explains the stop in plain words without internal vocabulary', () => {
    const message = buildRunStoppedMessage('repeating_step');

    expect(message).toContain('repeating the same step without making progress');
    expect(message).not.toMatch(/goal|tool|iteration|graph|CRITICAL/i);
    expect(message).not.toContain('Still unfinished');
  });

  it('lists the plan steps the run did not finish, one per line', () => {
    const message = buildRunStoppedMessage('step_limit', [
      { step: 'Find the flights', status: 'completed' },
      { step: 'Research Saturn moons', status: 'in_progress' },
      { step: 'Write the summary', status: 'pending' },
    ]);

    expect(message.split('\n').slice(-3)).toEqual([
      'Still unfinished:',
      '• Research Saturn moons',
      '• Write the summary',
    ]);
    expect(message).not.toContain('Find the flights');
  });

  it('lists nothing when every step finished or there was no plan', () => {
    expect(
      buildRunStoppedMessage('repeating_step', [{ step: 'Finished work', status: 'completed' }]),
    ).not.toContain('Still unfinished');
    expect(buildRunStoppedMessage('repeating_step', [])).not.toContain('Still unfinished');
  });

  it('speaks the user language instead of English', async () => {
    // Regression: these messages were English string literals in the engine, so an
    // Arabic or Japanese user read the reason their request stopped in English.
    await i18n.setLocale('ja');

    expect(buildRunStoppedMessage('approval_declined')).toBe(
      '承認が拒否されたため、その操作は行いませんでした。何も変更されていません。',
    );
    expect(
      buildRunStoppedMessage('step_limit', [{ step: '旅程を作成', status: 'in_progress' }])
        .split('\n')
        .slice(-2),
    ).toEqual(['未完了の項目：', '• 旅程を作成']);
  });

  it.each([
    'step_limit',
    'repeating_step',
    'memory_changed',
    'no_usable_reply',
    'no_way_to_continue',
    'approval_declined',
    'takeover_required',
    'action_not_recorded',
  ] as const)('resolves %s to a translated sentence rather than its key', (reason) => {
    const message = buildRunStoppedMessage(reason);

    expect(message).not.toContain('chat.runStopped');
    expect(message.length).toBeGreaterThan(20);
  });
});
