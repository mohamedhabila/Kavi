import { createSpokenReply, toSpokenText } from '../../src/services/voice/spokenReply';

function controllableAudio() {
  const spoken: string[] = [];
  const pending: Array<() => void> = [];
  return {
    spoken,
    /** Let the sentence being spoken finish. */
    finishSentence: async () => {
      pending.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    audio: {
      speak: jest.fn(
        (sentence: string) =>
          new Promise<void>((resolve) => {
            spoken.push(sentence);
            pending.push(resolve);
          }),
      ),
      stopSpeaking: jest.fn(async () => {
        pending.splice(0).forEach((resolve) => resolve());
      }),
      onQuiet: jest.fn(),
    },
  };
}

async function settle(times = 5) {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe('toSpokenText', () => {
  it('reads markdown as the words it renders to and leaves code out', () => {
    const spoken = toSpokenText(
      [
        '**Tomorrow** in Lisbon: sunny & warm.',
        '',
        '- 24 °C high',
        '- [Forecast](https://example.test/f)',
        '',
        '```js',
        'const a = 1;',
        '```',
        '',
        'Use `npm` 3.5 times.',
      ].join('\n'),
    );

    expect(spoken).toContain('Tomorrow in Lisbon: sunny & warm.');
    expect(spoken).toContain('24 °C high\nForecast\n');
    expect(spoken).toContain('Use npm 3.5 times.');
    expect(spoken).not.toMatch(/[*`[\]]|https|const a/u);
  });
});

describe('createSpokenReply', () => {
  it('speaks each sentence as soon as it is complete, and the rest when the reply is done', async () => {
    const { audio, spoken, finishSentence } = controllableAudio();
    const reply = createSpokenReply(audio);

    reply.update('It will be sunny');
    expect(spoken).toEqual([]);
    reply.update('It will be sunny. The high is 3.5');
    expect(spoken).toEqual(['It will be sunny.']);

    reply.update('It will be sunny. The high is 3.5 degrees warmer than today. Bring');
    await finishSentence();
    expect(spoken).toEqual(['It will be sunny.', 'The high is 3.5 degrees warmer than today.']);

    const done = reply.finish(
      'It will be sunny. The high is 3.5 degrees warmer than today. Bring a hat',
    );
    await finishSentence();
    await finishSentence();
    await done;
    expect(spoken).toEqual([
      'It will be sunny.',
      'The high is 3.5 degrees warmer than today.',
      'Bring a hat',
    ]);
  });

  it('ends sentences in scripts without spaces or with their own punctuation', async () => {
    const { audio, spoken, finishSentence } = controllableAudio();
    const reply = createSpokenReply(audio);

    reply.update('明日は晴れです。気温は二十四度');
    expect(spoken).toEqual(['明日は晴れです。']);
    await finishSentence();
    reply.update('明日は晴れです。気温は二十四度。هل تريد التفاصيل؟ نعم');
    await settle();
    expect(spoken).toEqual(['明日は晴れです。', '気温は二十四度。']);
    await finishSentence();
    expect(spoken).toEqual(['明日は晴れです。', '気温は二十四度。', 'هل تريد التفاصيل؟']);
  });

  it('says nothing twice when the finished reply repeats what streamed', async () => {
    const { audio, spoken, finishSentence } = controllableAudio();
    const reply = createSpokenReply(audio);

    reply.update('Checking your calendar.\n\n');
    await finishSentence();
    const done = reply.finish('Checking your calendar.\n\nYou are free at three.');
    await finishSentence();
    await done;

    expect(spoken).toEqual(['Checking your calendar.', 'You are free at three.']);
  });

  it('stops the sentence being spoken and drops the rest', async () => {
    const { audio, spoken } = controllableAudio();
    const reply = createSpokenReply(audio);

    reply.update('First sentence. Second sentence. Third');
    reply.stop();
    await reply.finish('First sentence. Second sentence. Third sentence.');

    expect(audio.stopSpeaking).toHaveBeenCalledTimes(1);
    expect(spoken).toEqual(['First sentence.']);
  });

  it('reports a speech failure when the reply finishes', async () => {
    const reply = createSpokenReply({
      speak: jest.fn().mockRejectedValue(new Error('TTS engine missing')),
      stopSpeaking: jest.fn(),
    });

    reply.update('Hello there. ');
    await settle();

    await expect(reply.finish('Hello there. More.')).rejects.toThrow('TTS engine missing');
  });

  it('says when it has spoken all that arrived while more is still coming', async () => {
    const { audio, finishSentence } = controllableAudio();
    const reply = createSpokenReply(audio);

    reply.update('Let me check. ');
    await finishSentence();
    expect(audio.onQuiet).toHaveBeenCalledTimes(1);

    const done = reply.finish('Let me check. Done.');
    await finishSentence();
    await done;
    expect(audio.onQuiet).toHaveBeenCalledTimes(1);
  });
});
