import {
  arePersistedAgentGoalUserConstraintsCanonical,
  captureCurrentUserGoalConstraint,
  MAX_AGENT_GOAL_USER_CONSTRAINT_CHARACTERS,
  normalizeAgentGoalUserConstraintText,
  readPersistedAgentGoalUserConstraintState,
} from '../../../src/engine/goals/userConstraints';

describe('goal user constraint capture and persistence', () => {
  it('normalizes NFC and line endings while preserving internal formatting', () => {
    expect(
      captureCurrentUserGoalConstraint({
        currentUserMessage: {
          id: 'user-1',
          text: '  Cafe\u0301\u00a0 local.\r\n\tDo  not upload it.  ',
        },
      }),
    ).toEqual({
      captured: true,
      constraint: {
        text: 'Café\u00a0 local.\n\tDo  not upload it.',
        sourceMessageId: 'user-1',
      },
    });
  });

  it('preserves exact multiline and tab-delimited output constraints', () => {
    const text = 'Output exactly:\r\n\tA  B\rC';
    expect(
      captureCurrentUserGoalConstraint({
        currentUserMessage: { id: 'user-format', text },
      }),
    ).toEqual({
      captured: true,
      constraint: {
        text: 'Output exactly:\n\tA  B\nC',
        sourceMessageId: 'user-format',
      },
    });
  });

  it('counts Unicode code points at the exact whole-message bound', () => {
    expect(
      normalizeAgentGoalUserConstraintText(
        `A${'😀'.repeat(MAX_AGENT_GOAL_USER_CONSTRAINT_CHARACTERS - 1)}`,
      ).valid,
    ).toBe(true);
    expect(
      normalizeAgentGoalUserConstraintText(
        `A${'😀'.repeat(MAX_AGENT_GOAL_USER_CONSTRAINT_CHARACTERS)}`,
      ),
    ).toEqual({ valid: false, code: 'oversized' });
  });

  it.each([
    ['', 'empty'],
    ['  ', 'empty'],
    ['.', 'unsupported'],
    ['No uploads\u200b', 'control_character'],
    ['No uploads\u202e', 'control_character'],
    ['No uploads\u000b', 'control_character'],
    ['\ufeffNo uploads', 'control_character'],
  ])('rejects unsafe or meaningless whole-message text %#', (value, code) => {
    expect(normalizeAgentGoalUserConstraintText(value)).toEqual({ valid: false, code });
  });

  it('allows language joiners while rejecting unrelated unsafe format controls', () => {
    for (const text of [
      'فایل‌ها را به‌صورت محلی نگه دار.',
      'Keep the 👨‍👩‍👧‍👦 photo local.',
      'क्‍ष फ़ाइल स्थानीय रखें।',
    ]) {
      expect(
        captureCurrentUserGoalConstraint({
          currentUserMessage: { id: 'user-joiner', text },
        }).captured,
      ).toBe(true);
    }
    for (const text of ['Keep local\u200b.', 'Keep local\u202e.']) {
      expect(
        captureCurrentUserGoalConstraint({
          currentUserMessage: { id: 'user-control', text },
        }),
      ).toMatchObject({
        captured: false,
        code: 'invalid_current_user_message',
        textCode: 'control_character',
      });
    }
  });

  it('retains full negation, abbreviation, URL, version, and correction context', () => {
    const text =
      'Do not use e.g. cloud uploads or example.com. Keep v1.2 local; actually, use Dutch.';
    expect(
      captureCurrentUserGoalConstraint({
        currentUserMessage: { id: 'user-full', text },
      }),
    ).toEqual({
      captured: true,
      constraint: { text, sourceMessageId: 'user-full' },
    });
  });

  it('rejects missing and malformed code-owned source identities', () => {
    expect(captureCurrentUserGoalConstraint({ currentUserMessage: undefined })).toEqual({
      captured: false,
      code: 'missing_current_user_message',
    });
    for (const id of [undefined, 42, {}, ' user-1', 'user-1 '] as const) {
      expect(
        captureCurrentUserGoalConstraint({
          currentUserMessage: { id: id as never, text: 'Keep local.' },
        }),
      ).toEqual({ captured: false, code: 'missing_current_user_message' });
    }
  });

  it('accepts only canonical exact persisted records with consistent lineage', () => {
    const canonical = [{ text: 'Keep local.', sourceMessageId: 'user-1' }];
    expect(arePersistedAgentGoalUserConstraintsCanonical(canonical)).toBe(true);
    expect(
      readPersistedAgentGoalUserConstraintState({ value: canonical, allowedOnGoal: true }),
    ).toEqual({ state: 'canonical', constraints: canonical });

    for (const invalid of [
      [{ text: ' Keep  local. ', sourceMessageId: 'user-1' }],
      [{ text: 'Keep local.', sourceMessageId: undefined }],
      [{ text: 'Keep local.', sourceMessageId: 'user-1', approval: true }],
      [canonical[0], canonical[0]],
      [
        { text: 'Keep local.', sourceMessageId: 'user-1' },
        { text: 'Use cloud.', sourceMessageId: 'user-1' },
      ],
    ]) {
      expect(arePersistedAgentGoalUserConstraintsCanonical(invalid)).toBe(false);
      expect(
        readPersistedAgentGoalUserConstraintState({ value: invalid, allowedOnGoal: true }),
      ).toEqual({ state: 'conflict' });
    }
    expect(
      readPersistedAgentGoalUserConstraintState({ value: canonical, allowedOnGoal: false }),
    ).toEqual({ state: 'conflict' });
  });
});
