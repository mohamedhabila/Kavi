import { NativeModules, Platform } from 'react-native';
import { resolveDirectSendReview } from '../../src/engine/tools/native/directSendReview';
import { executeNotificationsReply } from '../../src/engine/tools/native/notifications/executor';
import { replyToNotification } from '../../src/services/notifications/notificationReader';

const originalOS = Platform.OS;
const mockReader = {
  describe: jest.fn(),
  reply: jest.fn(),
};
const ID = '0|com.whatsapp|1|ana|10123';

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
  NativeModules.KaviNotificationReader = mockReader;
  mockReader.describe.mockResolvedValue({ app: 'WhatsApp', title: 'Ana Lopes' });
  mockReader.reply.mockResolvedValue({ status: 'sent', app: 'WhatsApp', title: 'Ana Lopes' });
});

afterEach(() => {
  setPlatform(originalOS);
  delete NativeModules.KaviNotificationReader;
});

describe('replying through a notification', () => {
  it("sends the reply through the app's own reply action", async () => {
    const outcome = await executeNotificationsReply({ id: ID, message: '  Yes, Friday works!  ' });

    expect(mockReader.reply).toHaveBeenCalledWith(ID, 'Yes, Friday works!');
    expect(outcome.status).toBe('completed');
    expect(JSON.parse(outcome.content)).toEqual({
      status: 'sent',
      app: 'WhatsApp',
      conversation: 'Ana Lopes',
      message: 'Yes, Friday works!',
    });
  });

  it.each([
    ['not_showing', 'not_found'],
    ['no_reply_action', 'unavailable'],
    ['expired', 'not_found'],
    ['not_granted', 'permission'],
  ] as const)('says why a %s reply was not sent', async (status, failureKind) => {
    mockReader.reply.mockResolvedValueOnce({ status });

    const outcome = await executeNotificationsReply({ id: ID, message: 'Hi' });

    expect(outcome).toMatchObject({ status: 'failed', failureKind });
    expect(JSON.parse(outcome.content)).toMatchObject({ status, code: status });
  });

  it('refuses an empty or oversized message before touching the phone', async () => {
    for (const message of ['   ', 'x'.repeat(4_001)]) {
      const outcome = await executeNotificationsReply({ id: ID, message });
      expect(outcome).toMatchObject({ status: 'failed', failureKind: 'invalid_arguments' });
    }
    expect(mockReader.reply).not.toHaveBeenCalled();
  });

  it('is unavailable on iOS, which lets no app answer other apps notifications', async () => {
    setPlatform('ios');

    await expect(replyToNotification(ID, 'Hi')).resolves.toEqual({ status: 'unavailable' });
    expect(mockReader.reply).not.toHaveBeenCalled();
  });
});

// A direct send has no screen after the approval, so the card must show who receives it,
// read from the phone, and exactly what will be sent.
describe('approving a reply', () => {
  it('names the app and conversation from the phone and shows the exact message', async () => {
    const review = await resolveDirectSendReview('notifications_reply', {
      id: ID,
      message: 'Yes,\nFriday works',
    });

    expect(mockReader.describe).toHaveBeenCalledWith(ID);
    expect(review).toEqual({
      title: 'Reply in WhatsApp to Ana Lopes',
      description: 'Yes, Friday works',
    });
  });

  it('falls back to a plain title when the phone no longer knows the notification', async () => {
    mockReader.describe.mockResolvedValueOnce(null);

    const review = await resolveDirectSendReview('notifications_reply', { id: ID, message: 'Hi' });

    expect(review).toEqual({ title: 'Reply to a notification', description: 'Hi' });
  });

  it('keeps a long message and long names inside what the approval card accepts', async () => {
    mockReader.describe.mockResolvedValueOnce({ app: 'W'.repeat(80), title: '👨‍👩‍👧'.repeat(30) });

    const review = await resolveDirectSendReview('notifications_reply', {
      id: ID,
      message: `${'👍🏽'.repeat(300)}‮`,
    });

    expect(review).toBeDefined();
    for (const [field, max] of [
      [review!.title, 120],
      [review!.description, 500],
    ] as const) {
      expect(Array.from(field).length).toBeLessThanOrEqual(max);
      expect(field).not.toMatch(/\p{C}/u);
      expect(field).toBe(field.normalize('NFC').trim());
    }
  });

  it('leaves every other tool to its usual summary', async () => {
    await expect(
      resolveDirectSendReview('sms_compose', { recipients: ['+15550100'], message: 'Hi' }),
    ).resolves.toBeUndefined();
  });
});
