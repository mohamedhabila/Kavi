import {
  responseDeliversVerifiedResult,
  responseIsUserVisibleText,
} from '../../src/services/agents/assistantResponseSignals';

describe('assistantResponseSignals', () => {
  it('treats an exact user-facing delivery of verified evidence as delivered', () => {
    expect(
      responseDeliversVerifiedResult({
        responseText:
          'Cairo weather: 14 C and clear.',
        evidenceTexts: [
          '{"temperatureC":14,"condition":"clear"}',
          'Cairo weather: 14 C and clear.',
        ],
      }),
    ).toBe(true);
  });

  it('does not treat a next-step narration as verified delivery', () => {
    expect(
      responseDeliversVerifiedResult({
        responseText: 'I will inspect the live weather first.',
        evidenceTexts: [
          '{"temperatureC":14,"condition":"clear"}',
          'Cairo weather: 14 C and clear.',
        ],
      }),
    ).toBe(false);
  });

  it('treats any non-machine-readable user-facing reply as visible text', () => {
    expect(responseIsUserVisibleText('What exact file should I inspect?')).toBe(true);
    expect(responseIsUserVisibleText('ما النتيجة المطلوبة؟')).toBe(true);
    expect(responseIsUserVisibleText('Please clarify the task and tell me the concrete outcome you want.')).toBe(true);
    expect(responseIsUserVisibleText('{"status":"completed"}')).toBe(false);
    expect(
      responseIsUserVisibleText(
        'The debug build now installs cleanly and the workflow completed.',
      ),
    ).toBe(true);
  });

  it('treats any user-visible text as delivered when no evidence text exists', () => {
    expect(
      responseDeliversVerifiedResult({
        responseText: 'What exact file should I inspect?',
        evidenceTexts: [],
      }),
    ).toBe(true);
  });
});
