import { buildMailtoUrl, normalizeEmailComposeArgs } from '../builders/email';
import {
  EmailComposeArgs,
  errorToNativeActionResult,
  makeActionFailure,
  makeActionResult,
  NativeActionResult,
} from '../types';
import { openExternalUrl } from './linking';

type MailComposerModule = typeof import('expo-mail-composer');

function loadMailComposer(): MailComposerModule | null {
  try {
    return require('expo-mail-composer') as MailComposerModule;
  } catch {
    return null;
  }
}

export async function composeEmail(
  args: EmailComposeArgs,
): Promise<NativeActionResult<Record<string, unknown>>> {
  try {
    const normalized = normalizeEmailComposeArgs(args);
    const MailComposer = loadMailComposer();

    if (MailComposer && (await MailComposer.isAvailableAsync())) {
      const composerResult = await MailComposer.composeAsync({
        recipients: normalized.recipients.length > 0 ? normalized.recipients : undefined,
        ccRecipients: normalized.ccRecipients.length > 0 ? normalized.ccRecipients : undefined,
        bccRecipients: normalized.bccRecipients.length > 0 ? normalized.bccRecipients : undefined,
        subject: normalized.subject,
        body: normalized.body,
        isHtml: normalized.isHtml,
        attachments: normalized.attachments.length > 0 ? normalized.attachments : undefined,
      });

      switch (composerResult.status) {
        case MailComposer.MailComposerStatus.CANCELLED:
          return makeActionResult(
            'cancelled',
            'Email composition was cancelled.',
            { rawStatus: composerResult.status },
            'email_compose_cancelled',
          );
        case MailComposer.MailComposerStatus.SAVED:
          return makeActionResult(
            'saved',
            'Email draft was saved.',
            { rawStatus: composerResult.status },
            'email_compose_saved',
          );
        case MailComposer.MailComposerStatus.SENT:
          return makeActionResult(
            'sent',
            'Email composer completed successfully.',
            { rawStatus: composerResult.status },
            'email_compose_sent',
          );
        default:
          return makeActionResult(
            'sent',
            'Email composer completed successfully.',
            { rawStatus: composerResult.status },
            'email_compose_completed',
          );
      }
    }

    if (!normalized.fallbackToMailto) {
      return makeActionFailure(
        'mail_composer_unavailable',
        'Mail compose is unavailable on this device.',
        undefined,
        'unavailable',
      );
    }

    if (normalized.attachments.length > 0) {
      return makeActionFailure(
        'mail_fallback_attachments_unsupported',
        'Mail compose fallback cannot attach files when the native composer is unavailable.',
        { attachmentCount: normalized.attachments.length },
        'unavailable',
      );
    }

    const mailtoUrl = buildMailtoUrl(normalized);
    return openExternalUrl(mailtoUrl, {
      summary: 'Opened the default mail app as a compose fallback.',
      successStatus: 'fallback_opened',
      successCode: 'email_compose_fallback_opened',
      details: {
        recipientCount: normalized.recipients.length,
      },
    });
  } catch (error) {
    return errorToNativeActionResult(error, 'email_compose_failed', 'Email compose failed');
  }
}
