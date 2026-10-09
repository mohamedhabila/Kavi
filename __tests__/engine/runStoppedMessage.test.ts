import { buildRunStoppedMessage } from '../../src/engine/graph/runStoppedMessage';
import { createGoal } from '../../src/engine/goals/types';
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

  it('lists the blocking goals left open, one per line', () => {
    const message = buildRunStoppedMessage('step_limit', [
      createGoal({
        id: 'g1',
        title: 'Research Saturn moons',
        status: 'active',
        completionPolicy: 'blocking',
      }),
      createGoal({
        id: 'g2',
        title: 'Write the summary',
        status: 'blocked',
        completionPolicy: 'blocking',
      }),
    ]);

    expect(message.split('\n').slice(-3)).toEqual([
      'Still unfinished:',
      '• Research Saturn moons',
      '• Write the summary',
    ]);
  });

  it('omits goals that are resolved, not blocking, or untitled', () => {
    const message = buildRunStoppedMessage('repeating_step', [
      createGoal({
        id: 'g1',
        title: 'Finished work',
        status: 'completed',
        completionPolicy: 'blocking',
      }),
      createGoal({
        id: 'g2',
        title: 'Background chore',
        status: 'active',
        completionPolicy: 'persistent',
      }),
      createGoal({ id: 'g3', title: '   ', status: 'active', completionPolicy: 'blocking' }),
    ]);

    expect(message).not.toContain('Still unfinished');
    expect(message).not.toContain('Finished work');
    expect(message).not.toContain('Background chore');
  });

  it('speaks the user language instead of English', async () => {
    // Regression: these messages were English string literals in the engine, so an
    // Arabic or Japanese user read the reason their request stopped in English.
    await i18n.setLocale('ja');

    expect(buildRunStoppedMessage('approval_declined')).toBe(
      '承認が拒否されたため、その操作は行いませんでした。何も変更されていません。',
    );
    expect(
      buildRunStoppedMessage('step_limit', [
        createGoal({
          id: 'g1',
          title: '旅程を作成',
          status: 'active',
          completionPolicy: 'blocking',
        }),
      ])
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
