import {
  isLikelyVoiceEcho,
  normalizeVoiceEchoText,
} from '../../src/services/voice/voiceEchoSimilarity';

describe('voice echo similarity', () => {
  it.each([
    ['Arabic', 'سأذكّرك بالموعد غدًا.', 'سأذكّرك بالموعد غدًا'],
    ['Japanese', '明日の予定を確認します。', '明日の予定を確認します'],
    ['Hindi', 'मैं कल आपको याद दिलाऊँगा।', 'मैं कल आपको याद दिलाऊँगा'],
    ['full-width forms', 'ＫＡＶＩ １２３', 'kavi 123'],
    ['emoji and symbols', 'تم 🌍 ✓', 'تم 🌍 ✓'],
  ])('matches an exact normalized %s transcript', (_label, spoken, transcript) => {
    expect(isLikelyVoiceEcho(transcript, spoken)).toBe(true);
  });

  it('matches a sufficiently long contained transcript without script-specific thresholds', () => {
    expect(
      isLikelyVoiceEcho(
        '東京の天気を確認しました',
        '東京の天気を確認しました。傘を持っていくと安心です。',
      ),
    ).toBe(true);
    expect(
      isLikelyVoiceEcho(
        'تم تأكيد الموعد وسيصل التذكير',
        'تم تأكيد الموعد وسيصل التذكير قبل نصف ساعة',
      ),
    ).toBe(true);
  });

  it('tolerates spacing differences in continuous scripts through code-point n-grams', () => {
    expect(isLikelyVoiceEcho('今日は 東京 に 行きます', '今日は東京に行きます')).toBe(true);
  });

  it('requires ordered textual identity in addition to shared words', () => {
    expect(
      isLikelyVoiceEcho(
        'gamma alpha delta beta epsilon',
        'alpha beta gamma delta epsilon',
      ),
    ).toBe(false);
    expect(isLikelyVoiceEcho('gamma alpha beta', 'alpha beta gamma')).toBe(false);
  });

  it.each([
    ['short shared fragment', 'yes', 'yes, your calendar was updated successfully'],
    ['unrelated Arabic', 'احجز سيارة إلى المطار', 'تم تحديث قائمة التسوق'],
    ['unrelated CJK', '明日は雨が降ります', '会議は午後三時です'],
    ['punctuation only', '……؟', '...'],
    ['empty', '', 'response'],
  ])('does not suppress %s input', (_label, transcript, spoken) => {
    expect(isLikelyVoiceEcho(transcript, spoken)).toBe(false);
  });

  it('normalizes compatibility forms and Unicode whitespace without ASCII filtering', () => {
    expect(normalizeVoiceEchoText('  ＫＡＶＩ\u3000会話\n🌍  ')).toBe('kavi 会話 🌍');
  });
});
