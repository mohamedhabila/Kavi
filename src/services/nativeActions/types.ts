import { Platform } from 'react-native';

export type NativeActionPlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos' | 'unknown';

export interface NativeActionResult<
  TDetails extends Record<string, unknown> | undefined = Record<string, unknown> | undefined,
> {
  status: string;
  summary: string;
  platform: NativeActionPlatform;
  code?: string;
  details?: TDetails;
}

export interface EmailComposeArgs {
  recipients?: string[];
  ccRecipients?: string[];
  bccRecipients?: string[];
  subject?: string;
  body?: string;
  isHtml?: boolean;
  attachments?: string[];
  fallbackToMailto?: boolean;
}

export interface SmsAttachmentInput {
  uri: string;
  mimeType: string;
  filename: string;
}

export interface SmsComposeArgs {
  recipients: string[];
  message: string;
  attachments?: SmsAttachmentInput[];
  defaultCountry?: string;
}

export interface PhoneCallArgs {
  number: string;
  defaultCountry?: string;
}

export interface MapsOpenArgs {
  query?: string;
  latitude?: number;
  longitude?: number;
  label?: string;
}

export interface ShareTextArgs {
  text: string;
  title?: string;
}

export interface ShareUrlArgs {
  url: string;
  message?: string;
  title?: string;
}

export interface ShareFileArgs {
  fileUri: string;
  mimeType?: string;
  dialogTitle?: string;
  uti?: string;
}

export interface ShareContactArgs {
  id: string;
  message?: string;
}

export interface ContactChannelInput {
  label?: string;
  value: string;
}

export interface ContactDraft {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  note?: string;
  emails?: ContactChannelInput[];
  phoneNumbers?: ContactChannelInput[];
}

export interface ContactsViewArgs {
  id: string;
}

export interface ContactsEditArgs extends ContactDraft {
  id: string;
}

export interface ContactsCreateArgs extends ContactDraft {}

export interface ContactsSearchFullArgs {
  query: string;
  limit?: number;
}

export interface ContactsGetFullArgs {
  id: string;
}

export interface ContactsManageAccessArgs {}

export interface OpenUrlArgs {
  url: string;
}

export class NativeActionError extends Error {
  readonly code: string;
  readonly status: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status = 'failed', details?: Record<string, unknown>) {
    super(message);
    this.name = 'NativeActionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function getNativeActionPlatform(): NativeActionPlatform {
  switch (Platform.OS) {
    case 'android':
    case 'ios':
    case 'web':
    case 'windows':
    case 'macos':
      return Platform.OS;
    default:
      return 'unknown';
  }
}

export function makeActionResult<TDetails extends Record<string, unknown> | undefined = undefined>(
  status: string,
  summary: string,
  details?: TDetails,
  code?: string,
): NativeActionResult<TDetails> {
  return {
    status,
    summary,
    platform: getNativeActionPlatform(),
    code,
    details,
  };
}

export function makeActionFailure(
  code: string,
  summary: string,
  details?: Record<string, unknown>,
  status = 'failed',
): NativeActionResult<Record<string, unknown>> {
  return makeActionResult(status, summary, details, code);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

export function errorToNativeActionResult(
  error: unknown,
  fallbackCode: string,
  fallbackSummary: string,
  extraDetails?: Record<string, unknown>,
): NativeActionResult<Record<string, unknown>> {
  if (error instanceof NativeActionError) {
    return makeActionResult(
      error.status,
      error.message,
      { ...(extraDetails || {}), ...(error.details || {}) },
      error.code,
    );
  }

  return makeActionFailure(
    fallbackCode,
    `${fallbackSummary}: ${getErrorMessage(error)}`,
    extraDetails,
  );
}
