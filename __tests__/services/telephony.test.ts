const mockSmsIsAvailable = jest.fn();
const mockSmsSendAsync = jest.fn();

jest.mock('expo-sms', () => ({
  isAvailableAsync: (...args: unknown[]) => mockSmsIsAvailable(...args),
  sendSMSAsync: (...args: unknown[]) => mockSmsSendAsync(...args),
}));

import { Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { resolveDirectSendReview } from '../../src/engine/tools/native/directSendReview';
import { placePhoneCall, sendSms } from '../../src/services/nativeActions/adapters/telephony';
import { normalizePhoneNumber } from '../../src/services/nativeActions/builders/phone';

const shown = (number: string) => normalizePhoneNumber(number).displayNumber;

const originalOS = Platform.OS;
const mockPhone = {
  placeCall: jest.fn(),
  postTapToCall: jest.fn(),
  getSmsAccess: jest.fn(),
  sendSms: jest.fn(),
};

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
  NativeModules.KaviPhone = mockPhone;
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  mockPhone.placeCall.mockResolvedValue('call_placed');
  mockPhone.postTapToCall.mockResolvedValue(true);
  mockPhone.getSmsAccess.mockResolvedValue('allowed');
  mockPhone.sendSms.mockResolvedValue({
    access: 'allowed',
    results: [{ recipient: '+15550102001', status: 'sent' }],
  });
  mockSmsIsAvailable.mockResolvedValue(true);
  mockSmsSendAsync.mockResolvedValue({ result: 'unknown' });
});

afterEach(() => {
  setPlatform(originalOS);
  delete NativeModules.KaviPhone;
  jest.restoreAllMocks();
});

describe('placing a call', () => {
  it('places it on Android, asking for the call permission the first time', async () => {
    jest.mocked(PermissionsAndroid.check).mockResolvedValueOnce(false);

    const result = await placePhoneCall({ number: '+1 555 010 2001' });

    expect(PermissionsAndroid.request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
    );
    expect(mockPhone.placeCall).toHaveBeenCalledWith('+15550102001');
    expect(result).toMatchObject({ executionStatus: 'completed', status: 'call_placed' });
  });

  it('reports the dialer when Android opened it instead', async () => {
    mockPhone.placeCall.mockResolvedValueOnce('dialer_opened');

    await expect(placePhoneCall({ number: '+15550102001' })).resolves.toMatchObject({
      status: 'opened',
      code: 'phone_call_opened',
    });
  });

  it('posts a tap-to-call notification when Kavi is not on screen', async () => {
    mockPhone.placeCall.mockResolvedValueOnce('not_in_foreground');

    const result = await placePhoneCall({ number: '+15550102001' });

    expect(mockPhone.postTapToCall).toHaveBeenCalledWith(
      '+15550102001',
      `Call ${shown('+15550102001')}`,
      'Tap to place the call you asked Kavi to make.',
      'Calls Kavi places',
    );
    expect(result).toMatchObject({ status: 'call_notification_posted' });
  });

  it('says so when that notification cannot be shown either', async () => {
    mockPhone.placeCall.mockResolvedValueOnce('not_in_foreground');
    mockPhone.postTapToCall.mockResolvedValueOnce(false);

    await expect(placePhoneCall({ number: '+15550102001' })).resolves.toMatchObject({
      executionStatus: 'failed',
      code: 'notifications_off',
    });
  });

  it('reports a device that cannot call', async () => {
    mockPhone.placeCall.mockResolvedValueOnce('unavailable');

    await expect(placePhoneCall({ number: '+15550102001' })).resolves.toMatchObject({
      executionStatus: 'failed',
      code: 'platform_unavailable',
    });
  });

  it('opens the system call confirmation on iOS', async () => {
    setPlatform('ios');

    const result = await placePhoneCall({ number: '+15550102001' });

    expect(Linking.openURL).toHaveBeenCalledWith('tel:+15550102001');
    expect(mockPhone.placeCall).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'opened' });
  });

  // "Call 911" was refused as an invalid phone number before the emergency check could see it.
  it.each(['911', '112', '1-1-2', '*#06#'])(
    'opens the dialer with an emergency or service number (%s) for the person to call',
    async (number) => {
      const result = await placePhoneCall({ number, defaultCountry: 'US' });

      expect(mockPhone.placeCall).not.toHaveBeenCalled();
      expect(Linking.openURL).toHaveBeenCalledWith(
        `tel:${encodeURIComponent(number.replace(/-/g, ''))}`,
      );
      expect(result).toMatchObject({ executionStatus: 'completed', status: 'opened' });
    },
  );

  it('refuses a number it cannot read before touching the phone', async () => {
    const result = await placePhoneCall({ number: 'call mum' });

    expect(result).toMatchObject({ executionStatus: 'failed', code: 'invalid_phone_number' });
    expect(mockPhone.placeCall).not.toHaveBeenCalled();
  });
});

describe('sending a text', () => {
  it('sends it as the default assistant and reports each recipient', async () => {
    const result = await sendSms({ recipients: ['+1 555 010 2001'], message: "I'm running late" });

    expect(mockPhone.sendSms).toHaveBeenCalledWith(['+15550102001'], "I'm running late");
    expect(result).toMatchObject({
      executionStatus: 'completed',
      status: 'sent',
      details: { recipients: [{ recipient: '+15550102001', status: 'sent' }] },
    });
    expect(mockSmsSendAsync).not.toHaveBeenCalled();
  });

  it.each([
    [[{ status: 'sent' }, { status: 'unknown' }], 'completed', 'sent_unconfirmed'],
    [
      [{ status: 'sent' }, { status: 'failed', error: 'no_service' }],
      'completed',
      'partially_sent',
    ],
    [[{ status: 'failed', error: 'radio_off' }, { status: 'failed' }], 'failed', 'failed'],
  ] as const)('summarizes mixed results %#', async (results, executionStatus, status) => {
    mockPhone.sendSms.mockResolvedValueOnce({
      access: 'allowed',
      results: results.map((result, index) => ({ recipient: `+1555010200${index}`, ...result })),
    });

    await expect(
      sendSms({ recipients: ['+15550102000', '+15550102001'], message: 'Hi' }),
    ).resolves.toMatchObject({ executionStatus, status });
  });

  it.each(['assistant_role_needed', 'permission_needed', 'unavailable'] as const)(
    'opens the composer with the message ready when Kavi may not send (%s)',
    async (access) => {
      mockPhone.getSmsAccess.mockResolvedValueOnce(access);

      const result = await sendSms({ recipients: ['+15550102001'], message: 'Hi' });

      expect(mockPhone.sendSms).not.toHaveBeenCalled();
      expect(mockSmsSendAsync).toHaveBeenCalledWith(['+15550102001'], 'Hi', expect.any(Object));
      expect(result).toMatchObject({
        executionStatus: 'completed',
        status: 'composer_opened',
        details: { sentDirectly: false, reason: access },
      });
    },
  );

  it('opens the composer on iOS, and reports a send the person made from it', async () => {
    setPlatform('ios');
    mockSmsSendAsync.mockResolvedValueOnce({ result: 'sent' });

    await expect(sendSms({ recipients: ['+15550102001'], message: 'Hi' })).resolves.toMatchObject({
      status: 'sent',
      details: { sentDirectly: false, reason: 'unavailable' },
    });
  });

  it('refuses no recipients or an overlong text before touching the phone', async () => {
    for (const args of [
      { recipients: [], message: 'Hi' },
      { recipients: ['+15550102001'], message: 'x'.repeat(1_601) },
    ]) {
      await expect(sendSms(args)).resolves.toMatchObject({ executionStatus: 'failed' });
    }
    expect(mockPhone.sendSms).not.toHaveBeenCalled();
  });
});

describe('approving a call or a text Kavi makes itself', () => {
  it('names the numbers and shows the text when the text will be sent directly', async () => {
    await expect(
      resolveDirectSendReview('sms_send', {
        recipients: ['+15550102001', '+15550102002', '+351912345003', '+819012345004'],
        message: 'Running\nlate',
      }),
    ).resolves.toEqual({
      title: `Text ${['+15550102001', '+15550102002', '+351912345003'].map(shown).join(', ')} +1`,
      description: 'Running late',
    });
  });

  it('leaves the composer, which shows the text itself, to the usual summary', async () => {
    mockPhone.getSmsAccess.mockResolvedValueOnce('assistant_role_needed');

    await expect(
      resolveDirectSendReview('sms_send', { recipients: ['+15550102001'], message: 'Hi' }),
    ).resolves.toBeUndefined();
  });

  it('names the number of a call Android places itself, and not of one iOS confirms', async () => {
    await expect(
      resolveDirectSendReview('phone_call', { number: '+15550102001' }),
    ).resolves.toEqual({
      title: `Call ${shown('+15550102001')}`,
      description: 'The call starts as soon as you approve.',
    });

    setPlatform('ios');
    await expect(
      resolveDirectSendReview('phone_call', { number: '+15550102001' }),
    ).resolves.toBeUndefined();
  });
});
