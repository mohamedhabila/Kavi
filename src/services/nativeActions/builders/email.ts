import { EmailComposeArgs, NativeActionError } from '../types';
import { resolveMailAttachmentUri } from '../files';
import {
  normalizeOptionalString,
  normalizeOptionalStringArray,
  validateEmailAddresses,
} from '../validators';

export interface NormalizedEmailComposeArgs {
  recipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  subject?: string;
  body?: string;
  isHtml: boolean;
  attachments: string[];
  fallbackToMailto: boolean;
}

function encodeQueryEntries(entries: Array<[string, string]>): string {
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function normalizeEmailComposeArgs(args: EmailComposeArgs): NormalizedEmailComposeArgs {
  const recipients = validateEmailAddresses(
    normalizeOptionalStringArray(args.recipients, 'recipients') || [],
    'recipients',
  );
  const ccRecipients = validateEmailAddresses(
    normalizeOptionalStringArray(args.ccRecipients, 'ccRecipients') || [],
    'ccRecipients',
  );
  const bccRecipients = validateEmailAddresses(
    normalizeOptionalStringArray(args.bccRecipients, 'bccRecipients') || [],
    'bccRecipients',
  );
  const subject = normalizeOptionalString(args.subject, 'subject');
  const body = normalizeOptionalString(args.body, 'body');
  const attachments = (normalizeOptionalStringArray(args.attachments, 'attachments') || []).map(
    (uri, index) => resolveMailAttachmentUri(uri, `attachments[${index}]`),
  );

  if (
    recipients.length === 0 &&
    ccRecipients.length === 0 &&
    bccRecipients.length === 0 &&
    !subject &&
    !body &&
    attachments.length === 0
  ) {
    throw new NativeActionError(
      'invalid_email_request',
      'Email compose requires at least one recipient, subject, body, or attachment.',
    );
  }

  return {
    recipients,
    ccRecipients,
    bccRecipients,
    subject,
    body,
    isHtml: args.isHtml === true,
    attachments,
    fallbackToMailto: args.fallbackToMailto !== false,
  };
}

export function buildMailtoUrl(args: NormalizedEmailComposeArgs): string {
  const baseRecipients = args.recipients
    .map((recipient) => encodeURIComponent(recipient))
    .join(',');
  const query: Array<[string, string]> = [];

  if (args.subject) {
    query.push(['subject', args.subject]);
  }
  if (args.body) {
    query.push(['body', args.body]);
  }
  if (args.ccRecipients.length > 0) {
    query.push(['cc', args.ccRecipients.join(',')]);
  }
  if (args.bccRecipients.length > 0) {
    query.push(['bcc', args.bccRecipients.join(',')]);
  }

  const queryString = query.length > 0 ? `?${encodeQueryEntries(query)}` : '';
  return `mailto:${baseRecipients}${queryString}`;
}
