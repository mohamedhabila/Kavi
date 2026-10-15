// ---------------------------------------------------------------------------
// Kavi — What the person approves before Kavi sends something for them
// ---------------------------------------------------------------------------
// A composer shows the message before the person taps send, so its approval can stay a
// redacted summary. A direct send has no screen after the approval: the approval card is
// the last thing the person sees, so it names who receives the message and shows the
// message itself. The recipient comes from the phone (the notification being answered),
// never from the model's arguments, and the text is exactly what will be sent.

import { i18n } from '../../../i18n/manager';
import { describeNotification } from '../../../services/notifications/notificationReader';
import { truncateGraphemesWithSuffix } from '../../../utils/graphemeBoundary';

export type DirectSendReview = Readonly<{ title: string; description: string }>;

/** The approval card's limits (approvalStore's isBoundedReviewPresentation). */
const MAX_TITLE_CODE_POINTS = 120;
const MAX_DESCRIPTION_CODE_POINTS = 500;
const MAX_NAME_CODE_POINTS = 40;

/**
 * One line of plain text the card can show: NFC, no control or format characters, at most
 * [max] code points (the card counts code points; a cut never splits a grapheme).
 */
function displayLine(value: string, max: number): string {
  const line = value
    .normalize('NFC')
    .replace(/\p{C}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  let graphemes = max;
  let shown = truncateGraphemesWithSuffix(line, graphemes, '…');
  while (Array.from(shown).length > max && graphemes > 1) {
    graphemes -= Array.from(shown).length - max;
    shown = truncateGraphemesWithSuffix(line, Math.max(1, graphemes), '…');
  }
  return shown;
}

async function notificationReplyReview(
  args: Record<string, unknown>,
): Promise<DirectSendReview | undefined> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const message =
    typeof args.message === 'string' ? displayLine(args.message, MAX_DESCRIPTION_CODE_POINTS) : '';
  if (!id || !message) return undefined;
  const target = await describeNotification(id);
  const app = target ? displayLine(target.app, MAX_NAME_CODE_POINTS) : '';
  const conversation = target ? displayLine(target.title, MAX_NAME_CODE_POINTS) : '';
  const title =
    app && conversation
      ? i18n.t('toolApproval.actions.notificationsReplyTo', { app, conversation })
      : i18n.t('toolApproval.actions.notificationsReplyTitle');
  return { title: displayLine(title, MAX_TITLE_CODE_POINTS), description: message };
}

/**
 * The card for a tool that sends on the person's behalf with nothing to confirm afterwards;
 * undefined for every other tool, which keeps its redacted summary.
 */
export async function resolveDirectSendReview(
  toolName: string,
  args: Record<string, unknown>,
): Promise<DirectSendReview | undefined> {
  switch (toolName) {
    case 'notifications_reply':
      return notificationReplyReview(args);
    default:
      return undefined;
  }
}
