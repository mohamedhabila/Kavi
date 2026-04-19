import { File } from 'expo-file-system';

const mockOpenURL = jest.fn();
const mockOpenSettings = jest.fn();
const mockShare = jest.fn();
const mockMailIsAvailable = jest.fn();
const mockMailComposeAsync = jest.fn();
const mockSmsIsAvailable = jest.fn();
const mockSmsSendAsync = jest.fn();
const mockSharingIsAvailable = jest.fn();
const mockSharingShareAsync = jest.fn();
const mockContactsIsAvailable = jest.fn();
const mockContactsGetPermissionsAsync = jest.fn();
const mockContactsRequestPermissionsAsync = jest.fn();
const mockContactsPresentPickerAsync = jest.fn();
const mockContactsPresentAccessPickerAsync = jest.fn();
const mockContactsPresentFormAsync = jest.fn();
const mockContactsShareContactAsync = jest.fn();
const mockContactsGetContactsAsync = jest.fn();
const mockContactsGetContactByIdAsync = jest.fn();
const mockContactsAddChangeListener = jest.fn();

jest.mock('react-native', () => ({
  Linking: {
    openURL: (...args: any[]) => mockOpenURL(...args),
    openSettings: (...args: any[]) => mockOpenSettings(...args),
  },
  Share: {
    share: (...args: any[]) => mockShare(...args),
    dismissedAction: 'dismissedAction',
    sharedAction: 'sharedAction',
  },
  Platform: { OS: 'ios' },
}));

jest.mock('expo-mail-composer', () => ({
  isAvailableAsync: (...args: any[]) => mockMailIsAvailable(...args),
  composeAsync: (...args: any[]) => mockMailComposeAsync(...args),
  MailComposerStatus: {
    CANCELLED: 'cancelled',
    SAVED: 'saved',
    SENT: 'sent',
    UNDETERMINED: 'undetermined',
  },
}));

jest.mock('expo-sms', () => ({
  isAvailableAsync: (...args: any[]) => mockSmsIsAvailable(...args),
  sendSMSAsync: (...args: any[]) => mockSmsSendAsync(...args),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...args: any[]) => mockSharingIsAvailable(...args),
  shareAsync: (...args: any[]) => mockSharingShareAsync(...args),
}));

jest.mock('expo-contacts', () => ({
  isAvailableAsync: (...args: any[]) => mockContactsIsAvailable(...args),
  getPermissionsAsync: (...args: any[]) => mockContactsGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: any[]) => mockContactsRequestPermissionsAsync(...args),
  presentContactPickerAsync: (...args: any[]) => mockContactsPresentPickerAsync(...args),
  presentAccessPickerAsync: (...args: any[]) => mockContactsPresentAccessPickerAsync(...args),
  presentFormAsync: (...args: any[]) => mockContactsPresentFormAsync(...args),
  shareContactAsync: (...args: any[]) => mockContactsShareContactAsync(...args),
  getContactsAsync: (...args: any[]) => mockContactsGetContactsAsync(...args),
  getContactByIdAsync: (...args: any[]) => mockContactsGetContactByIdAsync(...args),
  addContactsChangeListener: (...args: any[]) => mockContactsAddChangeListener(...args),
  Fields: {
    Name: 'name',
    PhoneNumbers: 'phoneNumbers',
    Emails: 'emails',
  },
}));

import { executeNativeAction } from '../../src/services/nativeActions/actionService';
import {
  createContact,
  editContact,
  getContactFull,
  manageLimitedContactAccess,
  pickContact,
  resetContactsAdapterStateForTests,
  searchContactsFull,
  shareContact,
} from '../../src/services/nativeActions/adapters/contacts';
import {
  openAppSettings,
  openExternalUrl,
} from '../../src/services/nativeActions/adapters/linking';
import { composeEmail } from '../../src/services/nativeActions/adapters/mail';
import { shareFile, shareText, shareUrl } from '../../src/services/nativeActions/adapters/share';
import { composeSms } from '../../src/services/nativeActions/adapters/sms';
import {
  errorToNativeActionResult,
  getErrorMessage,
  getNativeActionPlatform,
  NativeActionError,
} from '../../src/services/nativeActions/types';

const mockedPlatform = (jest.requireMock('react-native') as any).Platform as { OS: string };

describe('native action adapters and helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetContactsAdapterStateForTests();
    mockedPlatform.OS = 'ios';
    new File('file:///tmp/report.pdf').write('report');
    mockOpenURL.mockResolvedValue(true);
    mockOpenSettings.mockResolvedValue(undefined);
    mockShare.mockResolvedValue({ action: 'sharedAction', activityType: null });
    mockMailIsAvailable.mockResolvedValue(true);
    mockMailComposeAsync.mockResolvedValue({ status: 'sent' });
    mockSmsIsAvailable.mockResolvedValue(true);
    mockSmsSendAsync.mockResolvedValue({ result: 'sent' });
    mockSharingIsAvailable.mockResolvedValue(true);
    mockSharingShareAsync.mockResolvedValue(undefined);
    mockContactsIsAvailable.mockResolvedValue(true);
    mockContactsGetPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
      accessPrivileges: 'all',
      status: 'granted',
    });
    mockContactsRequestPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
      accessPrivileges: 'all',
      status: 'granted',
    });
    mockContactsPresentPickerAsync.mockResolvedValue({ id: 'contact-1', name: 'Jane Doe' });
    mockContactsPresentAccessPickerAsync.mockResolvedValue(['contact-2']);
    mockContactsPresentFormAsync.mockResolvedValue(undefined);
    mockContactsShareContactAsync.mockResolvedValue(undefined);
    mockContactsGetContactsAsync.mockResolvedValue({ data: [], hasNextPage: false });
    mockContactsGetContactByIdAsync.mockResolvedValue({ id: 'contact-1', name: 'Jane Doe' });
    mockContactsAddChangeListener.mockReturnValue({ remove: jest.fn() });
  });

  it('covers platform and error helper branches', () => {
    expect(getNativeActionPlatform()).toBe('ios');
    mockedPlatform.OS = 'visionos';
    expect(getNativeActionPlatform()).toBe('unknown');
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('plain-text')).toBe('plain-text');

    const typedError = errorToNativeActionResult(
      new NativeActionError('native_failure', 'Typed failure', 'unavailable', { foo: 'bar' }),
      'fallback_code',
      'Fallback summary',
      { extra: true },
    );
    expect(typedError).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        code: 'native_failure',
        details: expect.objectContaining({ foo: 'bar', extra: true }),
      }),
    );

    const genericError = errorToNativeActionResult(
      new Error('unexpected'),
      'fallback_code',
      'Fallback summary',
    );
    expect(genericError.summary).toContain('Fallback summary: unexpected');
  });

  it('covers linking success and failure branches', async () => {
    expect(await openExternalUrl('https://example.com', { summary: 'Opened docs' })).toEqual(
      expect.objectContaining({ status: 'opened' }),
    );

    mockOpenURL.mockRejectedValueOnce(new Error('no handler'));
    expect(await openExternalUrl('https://example.com', { summary: 'Opened docs' })).toEqual(
      expect.objectContaining({ code: 'open_external_url_failed' }),
    );

    expect(await openAppSettings()).toEqual(expect.objectContaining({ status: 'opened' }));
    mockOpenSettings.mockRejectedValueOnce(new Error('settings unavailable'));
    expect(await openAppSettings()).toEqual(
      expect.objectContaining({ code: 'settings_open_failed' }),
    );
  });

  it('covers email composer cancellation, save, unavailable, and validation branches', async () => {
    mockMailComposeAsync.mockResolvedValueOnce({ status: 'cancelled' });
    expect(await composeEmail({ recipients: ['jane@example.com'] })).toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );

    mockMailComposeAsync.mockResolvedValueOnce({ status: 'saved' });
    expect(await composeEmail({ recipients: ['jane@example.com'] })).toEqual(
      expect.objectContaining({ status: 'saved' }),
    );

    mockMailComposeAsync.mockResolvedValueOnce({ status: 'undetermined' });
    expect(await composeEmail({ recipients: ['jane@example.com'] })).toEqual(
      expect.objectContaining({ status: 'sent', code: 'email_compose_completed' }),
    );

    mockMailIsAvailable.mockResolvedValueOnce(false);
    expect(
      await composeEmail({ recipients: ['jane@example.com'], fallbackToMailto: false }),
    ).toEqual(
      expect.objectContaining({ status: 'unavailable', code: 'mail_composer_unavailable' }),
    );

    mockMailIsAvailable.mockResolvedValueOnce(false);
    expect(
      await composeEmail({
        recipients: ['jane@example.com'],
        attachments: ['file:///tmp/report.pdf'],
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        code: 'mail_fallback_attachments_unsupported',
      }),
    );

    expect(await composeEmail({ recipients: ['bad-email'] })).toEqual(
      expect.objectContaining({ code: 'invalid_email' }),
    );
  });

  it('covers share cancellation, invalid URLs, and unavailable file sharing', async () => {
    mockShare.mockResolvedValueOnce({ action: 'dismissedAction', activityType: null });
    expect(await shareText({ text: 'Hello' })).toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );

    expect(await shareText({ text: '' })).toEqual(
      expect.objectContaining({ code: 'invalid_arguments' }),
    );
    expect(await shareUrl({ url: 'mailto:jane@example.com' })).toEqual(
      expect.objectContaining({ code: 'disallowed_url_scheme' }),
    );

    mockSharingIsAvailable.mockResolvedValueOnce(false);
    expect(await shareFile({ fileUri: 'file:///tmp/report.pdf' })).toEqual(
      expect.objectContaining({ status: 'unavailable', code: 'file_share_unavailable' }),
    );

    expect(await shareFile({ fileUri: 'https://example.com/report.pdf' })).toEqual(
      expect.objectContaining({ code: 'invalid_file_uri' }),
    );

    expect(await shareFile({ fileUri: 'file:///tmp/report.pdf', mimeType: 'bad-mime' })).toEqual(
      expect.objectContaining({ code: 'invalid_mime_type' }),
    );
  });

  it('covers SMS unavailable, cancelled, and invalid attachment branches', async () => {
    mockSmsIsAvailable.mockResolvedValueOnce(false);
    expect(await composeSms({ recipients: ['+12125550101'], message: 'Hi' })).toEqual(
      expect.objectContaining({ status: 'unavailable', code: 'sms_unavailable' }),
    );

    mockSmsSendAsync.mockResolvedValueOnce({ result: 'cancelled' });
    expect(await composeSms({ recipients: ['+12125550101'], message: 'Hi' })).toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );

    mockedPlatform.OS = 'android';
    mockSmsSendAsync.mockResolvedValueOnce({ result: 'unknown' });
    expect(
      await composeSms({
        recipients: ['+12125550101'],
        message: 'Hi',
        attachments: [
          { uri: 'file:///tmp/report.pdf', mimeType: 'application/pdf', filename: 'report.pdf' },
        ],
      }),
    ).toEqual(expect.objectContaining({ status: 'sent', code: 'sms_compose_unknown' }));

    expect(mockSmsSendAsync).toHaveBeenLastCalledWith(
      ['+12125550101'],
      'Hi',
      expect.objectContaining({
        attachments: expect.objectContaining({ uri: 'content://mock-provider/tmp/report.pdf' }),
      }),
    );

    expect(
      await composeSms({
        recipients: ['+12125550101'],
        message: 'Hi',
        attachments: [{} as any],
      }),
    ).toEqual(expect.objectContaining({ code: 'invalid_arguments' }));
  });

  it('covers contacts unavailable, cancelled, permission-denied, not-found, payload, and limited-access branches', async () => {
    mockContactsIsAvailable.mockResolvedValueOnce(false);
    expect(await pickContact()).toEqual(
      expect.objectContaining({ status: 'unavailable', code: 'contacts_unavailable' }),
    );

    mockContactsPresentPickerAsync.mockResolvedValueOnce(null);
    expect(await pickContact()).toEqual(expect.objectContaining({ status: 'cancelled' }));

    mockContactsGetPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'none',
      status: 'denied',
    });
    mockContactsRequestPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
      accessPrivileges: 'none',
      status: 'denied',
    });
    expect(await editContact({ id: 'contact-1' })).toEqual(
      expect.objectContaining({
        status: 'permission_blocked',
        code: 'contacts_permission_blocked',
      }),
    );

    mockContactsGetPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'none',
      status: 'denied',
    });
    mockContactsRequestPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
      accessPrivileges: 'none',
      status: 'denied',
    });
    expect(await searchContactsFull({ query: 'Jane' })).toEqual(
      expect.objectContaining({ status: 'permission_denied', code: 'contacts_permission_denied' }),
    );

    mockContactsGetContactByIdAsync.mockResolvedValueOnce(undefined);
    expect(await getContactFull({ id: 'missing' })).toEqual(
      expect.objectContaining({ code: 'contact_not_found' }),
    );

    await createContact({
      firstName: 'Taylor',
      emails: [{ label: 'work', value: 'taylor@example.com' }],
      phoneNumbers: [{ label: 'mobile', value: '+12125550101' }],
    });
    expect(mockContactsPresentFormAsync).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        firstName: 'Taylor',
        emails: [{ label: 'work', email: 'taylor@example.com' }],
        phoneNumbers: [{ label: 'mobile', number: '+12125550101' }],
      }),
      expect.objectContaining({ isNew: true }),
    );

    mockContactsGetPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
      accessPrivileges: 'limited',
      status: 'granted',
    });
    expect(await manageLimitedContactAccess()).toEqual(
      expect.objectContaining({ status: 'completed', code: 'contacts_access_updated' }),
    );

    mockedPlatform.OS = 'android';
    expect(await manageLimitedContactAccess()).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        code: 'contacts_access_management_unavailable',
      }),
    );
  });

  it('caches full-read contact results and invalidates them after contact changes', async () => {
    const firstSearch = await searchContactsFull({ query: 'Jane', limit: 5 });
    const secondSearch = await searchContactsFull({ query: 'Jane', limit: 5 });

    expect(firstSearch.status).toBe('completed');
    expect(secondSearch.status).toBe('completed');
    expect(mockContactsGetContactsAsync).toHaveBeenCalledTimes(1);

    await editContact({ id: 'contact-1', firstName: 'Janet' });
    await searchContactsFull({ query: 'Jane', limit: 5 });
    expect(mockContactsGetContactsAsync).toHaveBeenCalledTimes(2);
  });

  it('covers contact sharing failure branch', async () => {
    mockContactsShareContactAsync.mockRejectedValueOnce(new Error('share failed'));

    const result = await shareContact({ id: 'contact-1' });
    expect(result).toEqual(expect.objectContaining({ code: 'contacts_share_failed' }));
  });

  it('covers actionService legacy and unknown-action branches', async () => {
    expect(await executeNativeAction('share', {})).toEqual(
      expect.objectContaining({ code: 'invalid_arguments' }),
    );

    expect(await executeNativeAction('contacts_manage_access', {})).toEqual(
      expect.objectContaining({
        code: 'contacts_access_management_inactive',
        status: 'unavailable',
      }),
    );

    expect(await executeNativeAction('unknown_native_action', {})).toEqual(
      expect.objectContaining({ code: 'unknown_native_action' }),
    );
  });
});
