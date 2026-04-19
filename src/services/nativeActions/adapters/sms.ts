import { Platform } from 'react-native';

import { normalizePhoneNumberList } from '../builders/phone';
import { normalizeOptionalMimeType, resolveSmsAttachmentUri } from '../files';
import {
  errorToNativeActionResult,
  makeActionFailure,
  makeActionResult,
  NativeActionError,
  NativeActionResult,
  SmsAttachmentInput,
  SmsComposeArgs,
} from '../types';
import { normalizeOptionalStringArray, normalizeRequiredString } from '../validators';

type SmsModule = typeof import('expo-sms');

function loadSmsModule(): SmsModule | null {
  try {
    return require('expo-sms') as SmsModule;
  } catch {
    return null;
  }
}

function normalizeSmsAttachments(value: unknown): SmsAttachmentInput[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new NativeActionError(
      'invalid_arguments',
      'attachments must be an array of SMS attachments.',
    );
  }

  return value.map((attachment, index) => {
    if (!attachment || typeof attachment !== 'object') {
      throw new NativeActionError('invalid_arguments', `attachments[${index}] must be an object.`);
    }

    const candidate = attachment as SmsAttachmentInput;
    return {
      uri: resolveSmsAttachmentUri(candidate.uri, `attachments[${index}].uri`),
      mimeType:
        normalizeOptionalMimeType(candidate.mimeType, `attachments[${index}].mimeType`) ||
        normalizeRequiredString(candidate.mimeType, `attachments[${index}].mimeType`),
      filename: normalizeRequiredString(candidate.filename, `attachments[${index}].filename`),
    };
  });
}

export async function composeSms(
  args: SmsComposeArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const recipients = normalizePhoneNumberList(
      normalizeOptionalStringArray(args.recipients, 'recipients') || [],
      'recipients',
      args.defaultCountry,
    );

    if (recipients.length === 0) {
      throw new NativeActionError(
        'invalid_arguments',
        'recipients must contain at least one phone number.',
      );
    }

    const message = normalizeRequiredString(args.message, 'message');
    const attachments = normalizeSmsAttachments(args.attachments);
    const SMS = loadSmsModule();

    if (!SMS || !(await SMS.isAvailableAsync())) {
      return makeActionFailure(
        'sms_unavailable',
        'SMS compose is unavailable on this device.',
        undefined,
        'unavailable',
      );
    }

    const smsResult = await SMS.sendSMSAsync(recipients, message, {
      attachments:
        attachments.length === 0
          ? undefined
          : attachments.length === 1
            ? attachments[0]
            : attachments,
    });

    switch (smsResult.result) {
      case 'cancelled':
        return makeActionResult(
          'cancelled',
          'SMS composition was cancelled.',
          { rawResult: smsResult.result },
          'sms_compose_cancelled',
        );
      case 'sent':
        return makeActionResult(
          'sent',
          'SMS composer completed successfully.',
          { rawResult: smsResult.result },
          'sms_compose_sent',
        );
      default:
        return makeActionResult(
          Platform.OS === 'android' ? 'sent' : 'unknown',
          Platform.OS === 'android'
            ? 'SMS composer opened successfully. Android does not report final send status.'
            : 'SMS composer completed without a final delivery status.',
          { rawResult: smsResult.result, platformReportedUnknown: smsResult.result === 'unknown' },
          'sms_compose_unknown',
        );
    }
  } catch (error) {
    return errorToNativeActionResult(error, 'sms_compose_failed', 'SMS compose failed');
  }
}
