import { Platform } from 'react-native';

import {
  getCachedContactResult,
  invalidateCachedContactResults,
  setCachedContactResult,
} from '../contactCache';
import {
  ContactDraft,
  ContactsCreateArgs,
  ContactsEditArgs,
  ContactsGetFullArgs,
  ContactsManageAccessArgs,
  ContactsSearchFullArgs,
  ContactsViewArgs,
  errorToNativeActionResult,
  makeActionFailure,
  makeActionResult,
  NativeActionError,
  NativeActionResult,
  ShareContactArgs,
} from '../types';
import { normalizeLimit, normalizeOptionalString, normalizeRequiredString } from '../validators';

let contactsChangeSubscription: { remove?: () => void } | null = null;

type ContactsModule = typeof import('expo-contacts');

function mapContactChannels(entries: any[] | undefined, valueKey: string) {
  return entries?.map((entry) => ({
    label: entry.label,
    value: entry[valueKey],
  }));
}

function mapContactPreview(contact: any) {
  return {
    id: contact.id,
    name: contact.name,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phones: mapContactChannels(contact.phoneNumbers, 'number'),
    emails: mapContactChannels(contact.emails, 'email'),
  };
}

function mapContactDetails(contact: any) {
  return {
    ...mapContactPreview(contact),
    addresses: contact.addresses?.map((address: any) => ({
      label: address.label,
      street: address.street,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
    })),
    company: contact.company,
    jobTitle: contact.jobTitle,
    birthday: contact.birthday,
    note: contact.note,
  };
}

function buildContactPayload(draft: ContactDraft) {
  const payload: Record<string, unknown> = {};
  const firstName = normalizeOptionalString(draft.firstName, 'firstName');
  const middleName = normalizeOptionalString(draft.middleName, 'middleName');
  const lastName = normalizeOptionalString(draft.lastName, 'lastName');
  const company = normalizeOptionalString(draft.company, 'company');
  const jobTitle = normalizeOptionalString(draft.jobTitle, 'jobTitle');
  const note = normalizeOptionalString(draft.note, 'note');

  if (firstName) payload.firstName = firstName;
  if (middleName) payload.middleName = middleName;
  if (lastName) payload.lastName = lastName;
  if (company) payload.company = company;
  if (jobTitle) payload.jobTitle = jobTitle;
  if (note) payload.note = note;

  if (Array.isArray(draft.phoneNumbers) && draft.phoneNumbers.length > 0) {
    payload.phoneNumbers = draft.phoneNumbers.map((entry, index) => ({
      label: normalizeOptionalString(entry.label, `phoneNumbers[${index}].label`) || 'mobile',
      number: normalizeRequiredString(entry.value, `phoneNumbers[${index}].value`),
    }));
  }

  if (Array.isArray(draft.emails) && draft.emails.length > 0) {
    payload.emails = draft.emails.map((entry, index) => ({
      label: normalizeOptionalString(entry.label, `emails[${index}].label`) || 'work',
      email: normalizeRequiredString(entry.value, `emails[${index}].value`),
    }));
  }

  return payload;
}

async function requireContactsModule() {
  let Contacts: ContactsModule;
  try {
    Contacts = require('expo-contacts') as ContactsModule;
  } catch {
    throw new NativeActionError(
      'contacts_unavailable',
      'Contacts features are unavailable on this device.',
      'unavailable',
    );
  }

  if (Contacts.isAvailableAsync && !(await Contacts.isAvailableAsync())) {
    throw new NativeActionError(
      'contacts_unavailable',
      'Contacts features are unavailable on this device.',
      'unavailable',
    );
  }

  return Contacts;
}

function ensureContactsChangeSubscription(ContactsModule: ContactsModule) {
  if (
    contactsChangeSubscription ||
    typeof ContactsModule.addContactsChangeListener !== 'function'
  ) {
    return;
  }

  contactsChangeSubscription = ContactsModule.addContactsChangeListener(() => {
    invalidateCachedContactResults();
  });
}

function invalidateContactCaches() {
  invalidateCachedContactResults();
}

function buildContactSearchCacheKey(query: string, limit: number, accessPrivileges?: string) {
  return `search:${query.toLowerCase()}:${limit}:${accessPrivileges || 'unknown'}`;
}

function buildContactGetCacheKey(id: string, accessPrivileges?: string) {
  return `get:${id}:${accessPrivileges || 'unknown'}`;
}

async function ensureContactsPermission(Contacts: any, options?: { skipIosPrompt?: boolean }) {
  if (Platform.OS === 'ios' && options?.skipIosPrompt) {
    return Contacts.getPermissionsAsync ? Contacts.getPermissionsAsync() : undefined;
  }

  const current = Contacts.getPermissionsAsync ? await Contacts.getPermissionsAsync() : undefined;

  if (current?.granted) {
    return current;
  }

  const requested = await Contacts.requestPermissionsAsync();
  if (requested.granted) {
    return requested;
  }

  throw new NativeActionError(
    requested.canAskAgain === false ? 'contacts_permission_blocked' : 'contacts_permission_denied',
    requested.canAskAgain === false
      ? 'Contacts permission is blocked in system settings.'
      : 'Contacts permission was denied.',
    requested.canAskAgain === false ? 'permission_blocked' : 'permission_denied',
    {
      canAskAgain: requested.canAskAgain,
      accessPrivileges: requested.accessPrivileges || 'none',
    },
  );
}

export async function pickContact(): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const Contacts = await requireContactsModule();
    const permission =
      Platform.OS === 'android'
        ? await ensureContactsPermission(Contacts)
        : await ensureContactsPermission(Contacts, { skipIosPrompt: true });

    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) {
      return makeActionResult(
        'cancelled',
        'Contact selection was cancelled.',
        { accessPrivileges: permission?.accessPrivileges || 'unknown' },
        'contacts_pick_cancelled',
      );
    }

    return makeActionResult(
      'picked',
      'Selected a contact from the native picker.',
      {
        accessPrivileges: permission?.accessPrivileges || 'unknown',
        contact: mapContactPreview(contact),
      },
      'contacts_pick_completed',
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'contacts_pick_failed', 'Contact picker failed');
  }
}

export async function viewContact(
  args: ContactsViewArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const id = normalizeRequiredString(args.id, 'id');
    const Contacts = await requireContactsModule();
    await ensureContactsPermission(Contacts, { skipIosPrompt: Platform.OS === 'ios' });

    await Contacts.presentFormAsync(id, undefined, {
      allowsActions: true,
      allowsEditing: false,
    });

    return makeActionResult(
      'opened',
      'Opened the native contact viewer.',
      { id },
      'contacts_view_opened',
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'contacts_view_failed', 'Viewing a contact failed');
  }
}

export async function editContact(
  args: ContactsEditArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const id = normalizeRequiredString(args.id, 'id');
    const Contacts = await requireContactsModule();
    await ensureContactsPermission(Contacts);
    ensureContactsChangeSubscription(Contacts);

    await Contacts.presentFormAsync(id, buildContactPayload(args) as any, {
      allowsActions: true,
      allowsEditing: true,
    });

    invalidateContactCaches();

    return makeActionResult(
      'opened',
      'Opened the native contact editor.',
      { id },
      'contacts_edit_opened',
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'contacts_edit_failed', 'Editing a contact failed');
  }
}

export async function createContact(
  args: ContactsCreateArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const Contacts = await requireContactsModule();
    await ensureContactsPermission(Contacts);
    ensureContactsChangeSubscription(Contacts);

    await Contacts.presentFormAsync(undefined, buildContactPayload(args) as any, {
      allowsActions: true,
      allowsEditing: true,
      isNew: true,
    });

    invalidateContactCaches();

    return makeActionResult(
      'opened',
      'Opened the native new-contact form.',
      {},
      'contacts_create_opened',
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'contacts_create_failed', 'Creating a contact failed');
  }
}

export async function shareContact(
  args: ShareContactArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const id = normalizeRequiredString(args.id, 'id');
    const message = normalizeOptionalString(args.message, 'message') || '';
    const Contacts = await requireContactsModule();
    await ensureContactsPermission(Contacts);

    if (Contacts.shareContactAsync) {
      await Contacts.shareContactAsync(id, message);
      return makeActionResult(
        'shared',
        'Opened the native share flow for a contact.',
        { id },
        'contacts_share_completed',
      );
    }

    return makeActionFailure(
      'contacts_share_unavailable',
      'Contact sharing is unavailable on this device.',
      { id },
      'unavailable',
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'contacts_share_failed', 'Sharing a contact failed');
  }
}

export async function manageLimitedContactAccess(
  _args?: ContactsManageAccessArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    if (Platform.OS !== 'ios') {
      return makeActionFailure(
        'contacts_access_management_unavailable',
        'Limited contact access management is only available on iOS.',
        undefined,
        'unavailable',
      );
    }

    const Contacts = await requireContactsModule();
    const permission = Contacts.getPermissionsAsync
      ? await Contacts.getPermissionsAsync()
      : undefined;

    if (!permission?.granted || permission.accessPrivileges !== 'limited') {
      return makeActionFailure(
        'contacts_access_management_inactive',
        'Limited contact access is not active for this app.',
        {
          accessPrivileges: permission?.accessPrivileges || 'none',
          canAskAgain: permission?.canAskAgain ?? null,
        },
        'unavailable',
      );
    }

    if (typeof Contacts.presentAccessPickerAsync !== 'function') {
      return makeActionFailure(
        'contacts_access_management_unavailable',
        'The native limited-access contacts picker is unavailable on this device.',
        { accessPrivileges: permission.accessPrivileges },
        'unavailable',
      );
    }

    ensureContactsChangeSubscription(Contacts);
    const grantedContactIds = await Contacts.presentAccessPickerAsync();
    invalidateContactCaches();

    return makeActionResult(
      'completed',
      grantedContactIds.length > 0
        ? `Updated limited contact access for ${grantedContactIds.length} contact(s).`
        : 'Contact access picker completed without adding new contacts.',
      {
        accessPrivileges: permission.accessPrivileges,
        grantedCount: grantedContactIds.length,
        grantedContactIds,
      },
      grantedContactIds.length > 0 ? 'contacts_access_updated' : 'contacts_access_unchanged',
    );
  } catch (error) {
    return errorToNativeActionResult(
      error,
      'contacts_access_management_failed',
      'Managing limited contact access failed',
    );
  }
}

export async function searchContactsFull(
  args: ContactsSearchFullArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const query = normalizeRequiredString(args.query, 'query');
    const limit = normalizeLimit(args.limit, 10, 25);
    const Contacts = await requireContactsModule();
    const permission = await ensureContactsPermission(Contacts);
    ensureContactsChangeSubscription(Contacts);

    const cacheKey = buildContactSearchCacheKey(query, limit, permission?.accessPrivileges);
    const cachedResult = getCachedContactResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const response = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      name: query,
      pageSize: limit,
    });

    return setCachedContactResult(
      cacheKey,
      makeActionResult(
        'completed',
        `Found ${response.data.length} contact(s) by name.`,
        {
          accessPrivileges: permission?.accessPrivileges || 'unknown',
          hasNextPage: response.hasNextPage,
          results: response.data.map(mapContactPreview),
        },
        'contacts_search_completed',
      ),
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'contacts_search_failed', 'Searching contacts failed');
  }
}

export async function getContactFull(
  args: ContactsGetFullArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const id = normalizeRequiredString(args.id, 'id');
    const Contacts = await requireContactsModule();
    const permission = await ensureContactsPermission(Contacts);
    ensureContactsChangeSubscription(Contacts);

    const cacheKey = buildContactGetCacheKey(id, permission?.accessPrivileges);
    const cachedResult = getCachedContactResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const contact = await Contacts.getContactByIdAsync(id);

    if (!contact) {
      return makeActionFailure('contact_not_found', 'Contact not found.', { id });
    }

    return setCachedContactResult(
      cacheKey,
      makeActionResult(
        'completed',
        'Loaded contact details.',
        {
          accessPrivileges: permission?.accessPrivileges || 'unknown',
          contact: mapContactDetails(contact),
        },
        'contacts_get_completed',
      ),
    );
  } catch (error) {
    return errorToNativeActionResult(error, 'contacts_get_failed', 'Reading a contact failed');
  }
}

export function resetContactsAdapterStateForTests() {
  invalidateContactCaches();
  contactsChangeSubscription?.remove?.();
  contactsChangeSubscription = null;
}
