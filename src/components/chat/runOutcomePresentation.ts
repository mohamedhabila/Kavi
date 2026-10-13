// ---------------------------------------------------------------------------
// Kavi — What a reply actually did
// ---------------------------------------------------------------------------
// An answer can say "saved" or "added to your calendar" whether or not it was. The
// code-owned effect receipts on each tool call record what really happened, so the
// chat shows those, in plain words, beside the answer: a person sees the work itself
// rather than taking the reply's word for it. Reads, searches and calculations change
// nothing and are left out; a change that failed is shown as failed.
// ---------------------------------------------------------------------------

import type { ToolCall } from '../../types/message';
import type { ToolEffectKind, ToolEffectReceipt } from '../../types/toolEffectReceipt';
import { truncateGraphemesWithSuffix } from '../../utils/graphemeBoundary';

export type RunOutcomeState = 'done' | 'pending' | 'failed';

export interface RunOutcomeEntry {
  readonly id: string;
  readonly effectKind: ToolEffectKind;
  readonly toolName: string;
  readonly state: RunOutcomeState;
  /** What the change touched, in the words of the call that made it: a path, a title. */
  readonly detail?: string;
}

/** Changes a person can see or check, each with its past-tense label. */
export const RUN_OUTCOME_LABEL_KEYS: Readonly<Partial<Record<ToolEffectKind, string>>> = {
  'artifact.write': 'runOutcome.savedFile',
  'artifact.delete': 'runOutcome.deletedFile',
  'memory.write': 'runOutcome.remembered',
  'memory.delete': 'runOutcome.forgot',
  'communication.draft_handoff': 'runOutcome.openedDraft',
  'communication.draft_save': 'runOutcome.savedDraft',
  'communication.send': 'runOutcome.sentMessage',
  'communication.call_handoff': 'runOutcome.startedCall',
  'calendar.create': 'runOutcome.addedEvent',
  'calendar.update': 'runOutcome.updatedEvent',
  'reminder.schedule': 'runOutcome.setReminder',
  'notification.send': 'runOutcome.sentNotification',
  'clipboard.write': 'runOutcome.copied',
  'share.handoff': 'runOutcome.shared',
  'contact.create': 'runOutcome.openedContact',
  'contact.update': 'runOutcome.openedContact',
  'contact.access_update': 'runOutcome.updatedContactAccess',
  'navigation.open': 'runOutcome.opened',
  'external.open': 'runOutcome.opened',
  'media.capture': 'runOutcome.captured',
  'workflow.start': 'runOutcome.startedWork',
  'workflow.mutate': 'runOutcome.changedAutomation',
  'remote.mutate': 'runOutcome.changedRemote',
};

const MAX_DETAIL_GRAPHEMES = 80;

function stateOf(receipt: ToolEffectReceipt): RunOutcomeState | undefined {
  switch (receipt.effectState) {
    case 'applied':
    case 'accepted':
    case 'handed_off':
      return 'done';
    case 'pending':
      return 'pending';
    case 'failed':
    case 'cancelled':
      return 'failed';
    default:
      return undefined;
  }
}

function parseArguments(toolCall: ToolCall): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(toolCall.arguments || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Arguments the model sent malformed still produced a receipt; the row keeps its label.
    return {};
  }
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value.filter((item) => typeof item === 'string' && item.trim()).join(', ');
      if (joined) return joined;
    }
  }
  return undefined;
}

function detailOf(
  effectKind: ToolEffectKind,
  receipt: ToolEffectReceipt,
  args: Record<string, unknown>,
): string | undefined {
  const raw = effectKind.startsWith('artifact.')
    ? firstText(
        receipt.resource?.kind === 'workspace_file' ? receipt.resource.id : undefined,
        args.path,
      )
    : effectKind.startsWith('communication.')
      ? firstText(args.recipients, args.to, args.subject)
      : effectKind === 'memory.write'
        ? firstText(args.content, args.text)
        : effectKind === 'workflow.start'
          ? firstText(args.name, args.label, args.task)
          : firstText(args.title, args.name, args.url, args.query);
  return raw ? truncateGraphemesWithSuffix(raw, MAX_DETAIL_GRAPHEMES, '…') : undefined;
}

/**
 * One row per change the reply's tool calls actually made, in the order they happened.
 * A call's latest receipt decides its state; the same change made twice shows once.
 */
export function buildRunOutcomeEntries(toolCalls: ReadonlyArray<ToolCall>): RunOutcomeEntry[] {
  const entries: RunOutcomeEntry[] = [];
  const indexByChange = new Map<string, number>();

  for (const toolCall of toolCalls) {
    const receipt = toolCall.effectReceipts?.at(-1);
    if (!receipt || !RUN_OUTCOME_LABEL_KEYS[receipt.effectKind]) continue;
    const state = stateOf(receipt);
    if (!state) continue;

    const detail = detailOf(receipt.effectKind, receipt, parseArguments(toolCall));
    const entry: RunOutcomeEntry = {
      id: toolCall.id,
      effectKind: receipt.effectKind,
      toolName: toolCall.name,
      state,
      ...(detail ? { detail } : {}),
    };
    const changeKey = `${receipt.effectKind}\u0000${detail ?? toolCall.id}`;
    const existing = indexByChange.get(changeKey);
    if (existing === undefined) {
      indexByChange.set(changeKey, entries.length);
      entries.push(entry);
    } else {
      // A retry that went through replaces the failed attempt it repeats.
      entries[existing] = entry;
    }
  }

  return entries;
}
