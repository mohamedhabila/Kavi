// ---------------------------------------------------------------------------
// Kavi — E2E fake phone: contacts, notifications and the SMS composer
// ---------------------------------------------------------------------------
// The address book the scenario's phone holds (one contact unless the scenario seeds its
// own), the notifications other apps showed (none unless seeded), and the recipients and
// text of the SMS draft the model opened.

import { normalizePhoneNumberList } from '../../services/nativeActions/builders/phone';

export type E2EFixtureContact = Readonly<{
  id: string;
  name: string;
  phoneNumbers: ReadonlyArray<Readonly<{ label: string; number: string }>>;
  emails?: ReadonlyArray<Readonly<{ label: string; email: string }>>;
}>;

export type E2EFixtureNotification = Readonly<{
  app: string;
  title: string;
  text: string;
  /** ISO time it was posted. */
  postedAt: string;
}>;

export type E2ESmsDraft = Readonly<{
  /** E.164 numbers, in the order the model gave them. */
  recipients: ReadonlyArray<string>;
  message: string;
}>;

const E2E_DEFAULT_CONTACTS: ReadonlyArray<E2EFixtureContact> = [
  {
    id: 'e2e-contact-avery',
    name: 'Avery Chen',
    phoneNumbers: [{ label: 'mobile', number: '+15550101001' }],
    emails: [{ label: 'work', email: 'avery@example.invalid' }],
  },
];

let e2eContacts: ReadonlyArray<E2EFixtureContact> = E2E_DEFAULT_CONTACTS;
let e2eNotifications: ReadonlyArray<E2EFixtureNotification> = [];

export function resetE2EMessagingFixtures(): void {
  e2eContacts = E2E_DEFAULT_CONTACTS;
  e2eNotifications = [];
}

export function seedE2ENotifications(notifications: ReadonlyArray<E2EFixtureNotification>): void {
  e2eNotifications = notifications;
}

/** What notifications_read returns on the scenario phone: the seed, newest first. */
export function readE2ENotifications(args: Record<string, unknown>): Record<string, unknown> {
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 30;
  const notifications = [...e2eNotifications]
    .sort((left, right) => Date.parse(right.postedAt) - Date.parse(left.postedAt))
    .slice(0, limit)
    .map((notification) => ({ ...notification, showing: true }));
  return { status: 'completed', count: notifications.length, notifications };
}

export function seedE2EContacts(contacts: ReadonlyArray<E2EFixtureContact>): void {
  e2eContacts = contacts;
}

function foldForNameSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** Contacts whose name contains the query, ignoring case and accents, as Contacts search does. */
export function searchE2EContacts(query: string): ReadonlyArray<E2EFixtureContact> {
  const needle = foldForNameSearch(query.trim());
  return e2eContacts.filter((contact) => foldForNameSearch(contact.name).includes(needle));
}

export function getE2EContact(id: unknown): E2EFixtureContact | null {
  return e2eContacts.find((contact) => contact.id === id) ?? null;
}

/**
 * The SMS draft the composer opens with, or why it cannot open: recipients must be phone
 * numbers (a contact's name is not one).
 */
export function buildE2ESmsDraft(
  args: Record<string, unknown>,
): { draft: E2ESmsDraft } | { error: string; code?: string } {
  const rawRecipients = Array.isArray(args.recipients)
    ? args.recipients.filter((recipient): recipient is string => typeof recipient === 'string')
    : [];
  let recipients: string[];
  try {
    recipients = normalizePhoneNumberList(
      rawRecipients,
      'recipients',
      typeof args.defaultCountry === 'string' && args.defaultCountry.trim()
        ? args.defaultCountry.trim()
        : undefined,
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid SMS recipients.',
      ...(typeof (error as { code?: unknown }).code === 'string'
        ? { code: (error as { code: string }).code }
        : {}),
    };
  }
  if (recipients.length === 0) {
    return { error: 'recipients must contain at least one phone number.' };
  }
  return {
    draft: { recipients, message: typeof args.message === 'string' ? args.message : '' },
  };
}
