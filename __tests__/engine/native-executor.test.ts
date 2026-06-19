import { File } from 'expo-file-system';

// ---------------------------------------------------------------------------
// Tests — Native Device Tool Executors
// ---------------------------------------------------------------------------

const mockGetStringAsync = jest.fn();
const mockSetStringAsync = jest.fn();
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

jest.mock('expo-clipboard', () => ({
  getStringAsync: (...args: any[]) => mockGetStringAsync(...args),
  setStringAsync: (...args: any[]) => mockSetStringAsync(...args),
}));

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

import {
  executeCalendarCreate,
  executeCalendarEvents,
  executeCalendarList,
  executeCalendarUpdate,
} from '../../src/engine/tools/native/calendar/executor';
import {
  executeClipboardRead,
  executeClipboardWrite,
} from '../../src/engine/tools/native/clipboard/executor';
import {
  executeContactsCreate,
  executeContactsEdit,
  executeContactsGet,
  executeContactsGetFull,
  executeContactsManageAccess,
  executeContactsPick,
  executeContactsSearch,
  executeContactsSearchFull,
  executeContactsShare,
  executeContactsView,
} from '../../src/engine/tools/native/contacts/executor';
import {
  executeEmailCompose,
  executeMapsOpen,
  executeOpenUrl,
  executePhoneCall,
  executeSmsCompose,
} from '../../src/engine/tools/native/communication/executor';
import { executeNativeTool } from '../../src/engine/tools/native/executor';
import { executeLocationCurrent } from '../../src/engine/tools/native/location/executor';
import {
  executeShare,
  executeShareContact,
  executeShareFile,
  executeShareText,
  executeShareUrl,
} from '../../src/engine/tools/native/share/executor';

beforeEach(() => {
  jest.clearAllMocks();
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
  mockContactsPresentAccessPickerAsync.mockResolvedValue(['contact-2']);
  mockContactsPresentPickerAsync.mockResolvedValue({
    id: 'contact-1',
    name: 'Jane Doe',
    firstName: 'Jane',
    lastName: 'Doe',
    phoneNumbers: [{ label: 'mobile', number: '+1 212-555-0101' }],
    emails: [{ label: 'work', email: 'jane@example.com' }],
  });
  mockContactsPresentFormAsync.mockResolvedValue(undefined);
  mockContactsShareContactAsync.mockResolvedValue(undefined);
  mockContactsAddChangeListener.mockReturnValue({ remove: jest.fn() });
  mockContactsGetContactsAsync.mockResolvedValue({
    data: [
      {
        id: 'contact-1',
        name: 'Jane Doe',
        firstName: 'Jane',
        lastName: 'Doe',
        phoneNumbers: [{ label: 'mobile', number: '+1 212-555-0101' }],
        emails: [{ label: 'work', email: 'jane@example.com' }],
      },
    ],
    hasNextPage: false,
  });
  mockContactsGetContactByIdAsync.mockResolvedValue({
    id: 'contact-1',
    name: 'Jane Doe',
    firstName: 'Jane',
    lastName: 'Doe',
    phoneNumbers: [{ label: 'mobile', number: '+1 212-555-0101' }],
    emails: [{ label: 'work', email: 'jane@example.com' }],
    addresses: [
      {
        label: 'home',
        street: '1 Main St',
        city: 'New York',
        region: 'NY',
        postalCode: '10001',
        country: 'US',
      },
    ],
    company: 'Kavi',
    jobTitle: 'PM',
    birthday: undefined,
    note: 'VIP',
  });
});

describe('executeClipboardRead', () => {
  it('returns clipboard text', async () => {
    mockGetStringAsync.mockResolvedValue('Hello from clipboard');
    const result = await executeClipboardRead();
    expect(result).toBe('Hello from clipboard');
  });

  it('returns empty message when clipboard is empty', async () => {
    mockGetStringAsync.mockResolvedValue('');
    const result = await executeClipboardRead();
    expect(result).toBe('(clipboard is empty)');
  });
});

describe('executeClipboardWrite', () => {
  it('copies text and returns confirmation', async () => {
    const result = await executeClipboardWrite({ text: 'Copy me' });
    expect(result).toBe('Copied 7 characters to clipboard');
    expect(mockSetStringAsync).toHaveBeenCalledWith('Copy me');
  });
});

describe('typed native actions', () => {
  it('opens reviewed URLs without canOpenURL preflight', async () => {
    const parsed = JSON.parse(await executeOpenUrl({ url: 'https://example.com/docs' }));
    expect(parsed.status).toBe('opened');
    expect(parsed.code).toBe('open_url_completed');
    expect(mockOpenURL).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('rejects disallowed open_url schemes', async () => {
    const parsed = JSON.parse(await executeOpenUrl({ url: 'ftp://example.com/archive' }));
    expect(parsed.code).toBe('disallowed_url_scheme');
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('composes email with the native composer when available', async () => {
    const parsed = JSON.parse(
      await executeEmailCompose({
        recipients: ['jane@example.com'],
        subject: 'Project update',
        body: 'Status attached.',
        attachments: ['file:///tmp/report.pdf'],
      }),
    );

    expect(parsed.status).toBe('sent');
    expect(mockMailComposeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['jane@example.com'],
        subject: 'Project update',
        body: 'Status attached.',
        attachments: ['file:///tmp/report.pdf'],
      }),
    );
  });

  it('falls back to mailto when the composer is unavailable and no attachments are requested', async () => {
    mockMailIsAvailable.mockResolvedValue(false);

    const parsed = JSON.parse(
      await executeEmailCompose({
        recipients: ['jane@example.com'],
        subject: 'Hello',
        body: 'Fallback path',
      }),
    );

    expect(parsed.status).toBe('fallback_opened');
    expect(mockOpenURL).toHaveBeenCalledWith(
      'mailto:jane%40example.com?subject=Hello&body=Fallback%20path',
    );
  });

  it('returns SMS composer status', async () => {
    mockSmsSendAsync.mockResolvedValue({ result: 'unknown' });
    const parsed = JSON.parse(
      await executeSmsCompose({
        recipients: ['+12125550101'],
        message: 'Hello',
      }),
    );
    expect(parsed.status).toBe('unknown');
  });

  it('treats Android unknown SMS status as a successful composer handoff and normalizes attachment URIs', async () => {
    const reactNative = jest.requireMock('react-native') as { Platform: { OS: string } };
    reactNative.Platform.OS = 'android';
    mockSmsSendAsync.mockResolvedValue({ result: 'unknown' });

    const parsed = JSON.parse(
      await executeSmsCompose({
        recipients: ['+12125550101'],
        message: 'Hello',
        attachments: [
          { uri: 'file:///tmp/report.pdf', mimeType: 'application/pdf', filename: 'report.pdf' },
        ],
      }),
    );

    expect(parsed.status).toBe('sent');
    expect(mockSmsSendAsync).toHaveBeenCalledWith(
      ['+12125550101'],
      'Hello',
      expect.objectContaining({
        attachments: expect.objectContaining({ uri: 'content://mock-provider/tmp/report.pdf' }),
      }),
    );
  });

  it('normalizes phone calls before opening the dialer', async () => {
    const parsed = JSON.parse(
      await executePhoneCall({ number: '212-555-0101', defaultCountry: 'US' }),
    );
    expect(parsed.status).toBe('opened');
    expect(mockOpenURL).toHaveBeenCalledWith('tel:+12125550101');
  });

  it('opens maps using the platform builder', async () => {
    const reactNative = jest.requireMock('react-native') as { Platform: { OS: string } };
    reactNative.Platform.OS = 'ios';
    const parsed = JSON.parse(await executeMapsOpen({ query: '1600 Amphitheatre Parkway' }));
    expect(parsed.status).toBe('opened');
    expect(mockOpenURL).toHaveBeenCalledWith(
      'http://maps.apple.com/?q=1600%20Amphitheatre%20Parkway',
    );
  });

  it('uses privacy-first contacts pick flow', async () => {
    const parsed = JSON.parse(await executeContactsPick());
    expect(parsed.status).toBe('picked');
    expect(parsed.details.contact.id).toBe('contact-1');
    expect(mockContactsPresentPickerAsync).toHaveBeenCalled();
  });

  it('opens the limited-access contacts manager when iOS contact access is limited', async () => {
    const reactNative = jest.requireMock('react-native') as { Platform: { OS: string } };
    reactNative.Platform.OS = 'ios';
    mockContactsGetPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
      accessPrivileges: 'limited',
      status: 'granted',
    });

    const parsed = JSON.parse(await executeContactsManageAccess());
    expect(parsed.status).toBe('completed');
    expect(parsed.code).toBe('contacts_access_updated');
    expect(mockContactsPresentAccessPickerAsync).toHaveBeenCalled();
  });

  it('opens native contact viewer and editor flows', async () => {
    const viewed = JSON.parse(await executeContactsView({ id: 'contact-1' }));
    const edited = JSON.parse(await executeContactsEdit({ id: 'contact-1', firstName: 'Janet' }));

    expect(viewed.status).toBe('opened');
    expect(edited.status).toBe('opened');
    expect(mockContactsPresentFormAsync).toHaveBeenNthCalledWith(
      1,
      'contact-1',
      undefined,
      expect.objectContaining({ allowsEditing: false }),
    );
    expect(mockContactsPresentFormAsync).toHaveBeenNthCalledWith(
      2,
      'contact-1',
      expect.objectContaining({ firstName: 'Janet' }),
      expect.objectContaining({ allowsEditing: true }),
    );
  });

  it('opens native create-contact flow', async () => {
    const parsed = JSON.parse(await executeContactsCreate({ firstName: 'Taylor' }));
    expect(parsed.status).toBe('opened');
    expect(mockContactsPresentFormAsync).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ firstName: 'Taylor' }),
      expect.objectContaining({ isNew: true }),
    );
  });

  it('supports full contact search and full contact read aliases', async () => {
    const searched = JSON.parse(await executeContactsSearch({ query: 'Jane' }));
    const fullSearch = JSON.parse(await executeContactsSearchFull({ query: 'Jane', limit: 5 }));
    const fetched = JSON.parse(await executeContactsGet({ id: 'contact-1' }));
    const fullFetch = JSON.parse(await executeContactsGetFull({ id: 'contact-1' }));

    expect(searched.status).toBe('completed');
    expect(fullSearch.status).toBe('completed');
    expect(fetched.status).toBe('completed');
    expect(fullFetch.status).toBe('completed');
    expect(fullFetch.details.contact.company).toBe('Kavi');
  });

  it('shares contacts through the native contact flow', async () => {
    const parsed = JSON.parse(
      await executeContactsShare({ id: 'contact-1', message: 'Reach out' }),
    );
    expect(parsed.status).toBe('shared');
    expect(mockContactsShareContactAsync).toHaveBeenCalledWith('contact-1', 'Reach out');
  });

  it('supports text, URL, file, and contact share flows', async () => {
    const textResult = JSON.parse(await executeShareText({ text: 'Hello' }));
    const urlResult = JSON.parse(
      await executeShareUrl({ url: 'https://example.com', message: 'Read this' }),
    );
    const fileResult = JSON.parse(
      await executeShareFile({ fileUri: 'file:///tmp/report.pdf', mimeType: 'application/pdf' }),
    );
    const contactResult = JSON.parse(await executeShareContact({ id: 'contact-1' }));

    expect(textResult.status).toBe('shared');
    expect(urlResult.status).toBe('shared');
    expect(fileResult.status).toBe('shared');
    expect(contactResult.status).toBe('shared');
    expect(mockShare).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'Hello' }));
    expect(mockShare).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: 'Read this', url: 'https://example.com' }),
    );
    expect(mockSharingShareAsync).toHaveBeenCalledWith(
      'file:///tmp/report.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
  });

  it('keeps legacy share compatible for text and URLs', async () => {
    const textParsed = JSON.parse(await executeShare({ text: 'Legacy text' }));
    const urlParsed = JSON.parse(
      await executeShare({ text: 'Legacy URL', url: 'https://example.com' }),
    );

    expect(textParsed.status).toBe('shared');
    expect(urlParsed.status).toBe('shared');
  });
});

describe('legacy native utilities', () => {
  it('still handles unavailable calendar and location modules gracefully', async () => {
    const calendarList = JSON.parse(await executeCalendarList());
    const calendarEvents = JSON.parse(
      await executeCalendarEvents({ startDate: '2024-01-01', endDate: '2024-01-31' }),
    );
    const calendarCreate = JSON.parse(
      await executeCalendarCreate({
        title: 'Meeting',
        startDate: '2024-01-01T10:00:00Z',
        endDate: '2024-01-01T11:00:00Z',
      }),
    );
    const calendarUpdate = JSON.parse(
      await executeCalendarUpdate({
        id: 'event-1',
        title: 'Updated meeting',
      }),
    );
    const location = JSON.parse(await executeLocationCurrent());

    expect(calendarList.error || calendarList.status).toBeDefined();
    expect(calendarEvents.error || calendarEvents.status).toBeDefined();
    expect(calendarCreate.error || calendarCreate.status).toBeDefined();
    expect(calendarUpdate.error || calendarUpdate.status).toBeDefined();
    expect(location.error || location.latitude).toBeDefined();
  });
});

describe('executeNativeTool', () => {
  it('routes the new native tools through the dispatcher', async () => {
    const emailResult = JSON.parse(
      await executeNativeTool(
        'email_compose',
        JSON.stringify({ recipients: ['jane@example.com'] }),
      ),
    );
    const smsResult = JSON.parse(
      await executeNativeTool(
        'sms_compose',
        JSON.stringify({ recipients: ['+12125550101'], message: 'Hi' }),
      ),
    );
    const contactResult = JSON.parse(await executeNativeTool('contacts_pick', '{}'));
    const accessResult = JSON.parse(await executeNativeTool('contacts_manage_access', '{}'));
    const shareResult = JSON.parse(
      await executeNativeTool('share_file', JSON.stringify({ fileUri: 'file:///tmp/report.pdf' })),
    );

    expect(emailResult.status).toBe('sent');
    expect(smsResult.status).toBe('sent');
    expect(contactResult.status).toBe('picked');
    expect(accessResult.status).toBe('unavailable');
    expect(shareResult.status).toBe('shared');
  });

  it('routes calendar update through the dispatcher', async () => {
    const result = JSON.parse(
      await executeNativeTool(
        'calendar_update_event',
        JSON.stringify({ id: 'event-1', title: 'Updated meeting' }),
      ),
    );

    expect(result.error || result.status).toBeDefined();
  });

  it('returns error for unknown native tools', async () => {
    const result = await executeNativeTool('nonexistent', '{}');
    expect(result).toContain('unknown native tool');
  });

  it('returns error for invalid JSON', async () => {
    const result = await executeNativeTool('clipboard_read', 'not-json');
    expect(result).toContain('invalid tool arguments JSON');
  });
});
