import type { Conversation } from '../../types/conversation';
import { isExactDurableScopeId } from '../../utils/durableScopeIdentity';
import { decideProactiveAssistantAction } from './proactiveAssistantPolicy';

export const PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const PROACTIVE_TASK_PROPOSAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS = 2;

export type ProactiveTaskProposalDisposition = 'presented' | 'dismissed' | 'accepted';

export interface ProactiveTaskProposal {
  id: string;
  identityKey: string;
  kind: 'continue_failed_task';
  conversationId: string;
  runId: string;
  sourceUserMessageId: string;
  sourceUpdatedAt: number;
}

export interface ProactiveTaskProposalReceipt {
  proposalId: string;
  conversationId: string;
  runId: string;
  sourceUpdatedAt: number;
  disposition: ProactiveTaskProposalDisposition;
  presentationCount: number;
  lastPresentedAt: number;
  respondedAt?: number;
}

export type ProactiveTaskProposalReceipts = Record<string, ProactiveTaskProposalReceipt>;

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function createProactiveTaskProposalIdentityKey(identity: {
  conversationId: string;
  runId: string;
}): string | undefined {
  if (!isExactDurableScopeId(identity.conversationId) || !isExactDurableScopeId(identity.runId)) {
    return undefined;
  }

  return `${identity.conversationId.length}:${identity.conversationId}${identity.runId.length}:${identity.runId}`;
}

function deriveProposalEvidence(
  conversation: Conversation | undefined,
  now: number,
): ProactiveTaskProposal | undefined {
  if (!conversation || !isExactDurableScopeId(conversation.id) || !isFiniteTimestamp(now)) {
    return undefined;
  }
  if (
    conversation.activeAgentRunId !== undefined ||
    !Array.isArray(conversation.agentRuns) ||
    !Array.isArray(conversation.messages)
  ) {
    return undefined;
  }

  const runs = conversation.agentRuns ?? [];
  const run = runs[runs.length - 1];
  if (
    !run ||
    run.status !== 'failed' ||
    run.terminalReason === 'user_cancelled' ||
    !isExactDurableScopeId(run.id) ||
    !isExactDurableScopeId(run.userMessageId) ||
    !isFiniteTimestamp(run.createdAt) ||
    !isFiniteTimestamp(run.updatedAt) ||
    !isFiniteTimestamp(run.completedAt) ||
    run.updatedAt > now ||
    run.completedAt > now ||
    run.completedAt < run.createdAt ||
    now - run.completedAt > PROACTIVE_TASK_PROPOSAL_MAX_AGE_MS ||
    (run.controlGraph?.asyncWork?.pendingOperations?.length ?? 0) > 0
  ) {
    return undefined;
  }

  const sourceMessage = conversation.messages.find((message) => message.id === run.userMessageId);
  const latestUserMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'user');
  if (
    !sourceMessage ||
    sourceMessage !== latestUserMessage ||
    sourceMessage.role !== 'user' ||
    !isFiniteTimestamp(sourceMessage.timestamp) ||
    sourceMessage.timestamp > run.createdAt ||
    typeof sourceMessage.content !== 'string' ||
    (!sourceMessage.content.trim() && !sourceMessage.attachments?.length)
  ) {
    return undefined;
  }

  const identityKey = createProactiveTaskProposalIdentityKey({
    conversationId: conversation.id,
    runId: run.id,
  });
  if (!identityKey) {
    return undefined;
  }

  return {
    id: run.id,
    identityKey,
    kind: 'continue_failed_task',
    conversationId: conversation.id,
    runId: run.id,
    sourceUserMessageId: sourceMessage.id,
    sourceUpdatedAt: run.completedAt,
  };
}

function receiptMatchesProposal(
  receipt: ProactiveTaskProposalReceipt,
  proposal: ProactiveTaskProposal,
): boolean {
  return (
    receipt.proposalId === proposal.id &&
    receipt.conversationId === proposal.conversationId &&
    receipt.runId === proposal.runId &&
    receipt.sourceUpdatedAt === proposal.sourceUpdatedAt &&
    (receipt.disposition === 'presented' ||
      receipt.disposition === 'dismissed' ||
      receipt.disposition === 'accepted') &&
    Number.isInteger(receipt.presentationCount) &&
    receipt.presentationCount >= 1 &&
    receipt.presentationCount <= PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS &&
    isFiniteTimestamp(receipt.lastPresentedAt) &&
    receipt.lastPresentedAt >= receipt.sourceUpdatedAt &&
    (receipt.respondedAt === undefined ||
      (isFiniteTimestamp(receipt.respondedAt) && receipt.respondedAt >= receipt.lastPresentedAt))
  );
}

export function selectProactiveTaskProposal(params: {
  conversation?: Conversation;
  now: number;
  presentedThisSession: Readonly<Record<string, true>>;
  receipts: Readonly<ProactiveTaskProposalReceipts>;
}): ProactiveTaskProposal | undefined {
  const proposal = deriveProposalEvidence(params.conversation, params.now);
  if (!proposal) {
    return undefined;
  }

  const receipt = params.receipts[proposal.identityKey];
  const presentedThisSession = params.presentedThisSession[proposal.identityKey] === true;
  if (receipt) {
    if (!receiptMatchesProposal(receipt, proposal)) {
      return undefined;
    }
    if (receipt.disposition === 'dismissed' || receipt.disposition === 'accepted') {
      return undefined;
    }
    if (
      !presentedThisSession &&
      (receipt.presentationCount >= PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS ||
        params.now - receipt.lastPresentedAt < PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS)
    ) {
      return undefined;
    }
  }

  const decision = decideProactiveAssistantAction({
    proposalId: proposal.id,
    initiative: 'assistant_initiated',
    preference: {
      disposition: 'accepted',
      source: 'explicit_request',
      confidence: 1,
    },
    expectedBenefit: 0.9,
    relevanceConfidence: 1,
    userBurden: 0.1,
    missingRequiredInformation: false,
    readOnlyLookupCanResolve: false,
    effect: 'none',
    sensitive: false,
    requiresConsent: false,
    authorization: { kind: 'none', state: 'none' },
  });

  return decision.action === 'suggest' ? proposal : undefined;
}

export function isProactiveTaskProposalReceipt(
  value: unknown,
  identityKey?: string,
): value is ProactiveTaskProposalReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const receipt = value as ProactiveTaskProposalReceipt;
  const expectedIdentityKey = createProactiveTaskProposalIdentityKey(receipt);
  if (!expectedIdentityKey || (identityKey !== undefined && expectedIdentityKey !== identityKey)) {
    return false;
  }

  const proposal: ProactiveTaskProposal = {
    id: receipt.proposalId,
    identityKey: expectedIdentityKey,
    kind: 'continue_failed_task',
    conversationId: receipt.conversationId,
    runId: receipt.runId,
    sourceUserMessageId: receipt.proposalId,
    sourceUpdatedAt: receipt.sourceUpdatedAt,
  };
  return isExactDurableScopeId(receipt.proposalId) && receiptMatchesProposal(receipt, proposal);
}
