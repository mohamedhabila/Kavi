import { Linking } from 'react-native';
import { executeChatCompose } from '../../src/engine/tools/native/communication/executor';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('opening a chat with the message typed in', () => {
  it.each([
    ['whatsapp', 'https://wa.me/351912345003?text=Chego%20%C3%A0s%208%20%F0%9F%91%8D'],
    ['telegram', 'https://t.me/+351912345003?text=Chego%20%C3%A0s%208%20%F0%9F%91%8D'],
  ])("opens the person's %s chat by phone number", async (app, url) => {
    const outcome = await executeChatCompose({
      app,
      phoneNumber: '912 345 003',
      defaultCountry: 'PT',
      message: 'Chego às 8 👍',
    });

    expect(Linking.openURL).toHaveBeenCalledWith(url);
    expect(outcome.status).toBe('completed');
    expect(JSON.parse(outcome.content)).toMatchObject({
      status: 'opened',
      code: 'chat_opened',
      details: { app, number: '+351912345003' },
    });
  });

  it('refuses an app it cannot open, or a number it cannot read, without opening anything', async () => {
    for (const args of [
      { app: 'signal', phoneNumber: '+351912345003', message: 'Hi' },
      { app: 'whatsapp', phoneNumber: 'Ana', message: 'Hi' },
      { app: 'whatsapp', phoneNumber: '+351912345003', message: '  ' },
    ]) {
      const outcome = await executeChatCompose(args);
      expect(outcome).toMatchObject({ status: 'failed', failureKind: 'invalid_arguments' });
    }
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('says so when the link cannot be opened', async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('No app handles it'));

    const outcome = await executeChatCompose({
      app: 'telegram',
      phoneNumber: '+351912345003',
      message: 'Hi',
    });

    expect(outcome.status).toBe('failed');
  });
});
