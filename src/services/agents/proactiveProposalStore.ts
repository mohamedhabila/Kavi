import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../../constants/storage';
import {
  PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS,
  PROACTIVE_TASK_PROPOSAL_MAX_AGE_MS,
  PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS,
  createProactiveTaskProposalIdentityKey,
  isProactiveTaskProposalReceipt,
  type ProactiveTaskProposal,
  type ProactiveTaskProposalReceipt,
  type ProactiveTaskProposalReceipts,
} from './proactiveTaskProposal';

type ProactiveProposalPersistedState = {
  receipts: ProactiveTaskProposalReceipts;
};

interface ProactiveProposalState extends ProactiveProposalPersistedState {
  presentedThisSession: Record<string, true>;
  markPresented: (proposal: ProactiveTaskProposal, now?: number) => void;
  accept: (proposal: ProactiveTaskProposal, now?: number) => void;
  dismiss: (proposal: ProactiveTaskProposal, now?: number) => void;
}

const RECEIPT_RETENTION_MS =
  PROACTIVE_TASK_PROPOSAL_MAX_AGE_MS + PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS;

function validActionTimestamp(proposal: ProactiveTaskProposal, now: number): boolean {
  return Number.isFinite(now) && now > 0 && now >= proposal.sourceUpdatedAt;
}

function proposalIdentityIsValid(proposal: ProactiveTaskProposal): boolean {
  return (
    proposal.id === proposal.runId &&
    proposal.identityKey === createProactiveTaskProposalIdentityKey(proposal)
  );
}

function pruneReceipts(
  receipts: Readonly<ProactiveTaskProposalReceipts>,
  now: number,
): ProactiveTaskProposalReceipts {
  return Object.fromEntries(
    Object.entries(receipts).filter(
      ([identityKey, receipt]) =>
        isProactiveTaskProposalReceipt(receipt, identityKey) &&
        now - receipt.sourceUpdatedAt <= RECEIPT_RETENTION_MS,
    ),
  );
}

function createReceipt(
  proposal: ProactiveTaskProposal,
  now: number,
  current?: ProactiveTaskProposalReceipt,
): ProactiveTaskProposalReceipt {
  return {
    proposalId: proposal.id,
    conversationId: proposal.conversationId,
    runId: proposal.runId,
    sourceUpdatedAt: proposal.sourceUpdatedAt,
    disposition: 'presented',
    presentationCount: Math.min(
      PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS,
      (current?.presentationCount ?? 0) + 1,
    ),
    lastPresentedAt: now,
  };
}

function normalizePersistedState(value: unknown): ProactiveProposalPersistedState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { receipts: {} };
  }
  const receiptsValue = (value as { receipts?: unknown }).receipts;
  if (!receiptsValue || typeof receiptsValue !== 'object' || Array.isArray(receiptsValue)) {
    return { receipts: {} };
  }

  return {
    receipts: Object.fromEntries(
      Object.entries(receiptsValue).filter(([identityKey, receipt]) =>
        isProactiveTaskProposalReceipt(receipt, identityKey),
      ),
    ),
  };
}

export const useProactiveProposalStore = create<ProactiveProposalState>()(
  persist(
    (set) => ({
      receipts: {},
      presentedThisSession: {},

      markPresented: (proposal, timestamp = Date.now()) =>
        set((state) => {
          if (!proposalIdentityIsValid(proposal) || !validActionTimestamp(proposal, timestamp)) {
            return state;
          }
          if (state.presentedThisSession[proposal.identityKey]) {
            return state;
          }

          const receipts = pruneReceipts(state.receipts, timestamp);
          const current = receipts[proposal.identityKey];
          if (
            current &&
            (!isProactiveTaskProposalReceipt(current, proposal.identityKey) ||
              current.proposalId !== proposal.id ||
              current.sourceUpdatedAt !== proposal.sourceUpdatedAt ||
              current.disposition !== 'presented' ||
              current.presentationCount >= PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS ||
              timestamp - current.lastPresentedAt < PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS)
          ) {
            return state;
          }

          return {
            receipts: {
              ...receipts,
              [proposal.identityKey]: createReceipt(proposal, timestamp, current),
            },
            presentedThisSession: {
              ...state.presentedThisSession,
              [proposal.identityKey]: true,
            },
          };
        }),

      accept: (proposal, timestamp = Date.now()) =>
        set((state) => respondToProposal(state, proposal, 'accepted', timestamp)),

      dismiss: (proposal, timestamp = Date.now()) =>
        set((state) => respondToProposal(state, proposal, 'dismissed', timestamp)),
    }),
    {
      name: STORAGE_KEYS.PROACTIVE_PROPOSALS,
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state): ProactiveProposalPersistedState => ({ receipts: state.receipts }),
      merge: (persisted, current) => ({
        ...current,
        ...normalizePersistedState(persisted),
        presentedThisSession: {},
      }),
    },
  ),
);

function respondToProposal(
  state: ProactiveProposalState,
  proposal: ProactiveTaskProposal,
  disposition: 'accepted' | 'dismissed',
  now: number,
): Partial<ProactiveProposalState> | ProactiveProposalState {
  if (!proposalIdentityIsValid(proposal) || !validActionTimestamp(proposal, now)) {
    return state;
  }

  const receipts = pruneReceipts(state.receipts, now);
  const current = receipts[proposal.identityKey];
  if (
    current &&
    (!isProactiveTaskProposalReceipt(current, proposal.identityKey) ||
      current.proposalId !== proposal.id ||
      current.sourceUpdatedAt !== proposal.sourceUpdatedAt ||
      current.disposition !== 'presented')
  ) {
    return state;
  }
  const presented = current ?? createReceipt(proposal, now);

  return {
    receipts: {
      ...receipts,
      [proposal.identityKey]: {
        ...presented,
        disposition,
        respondedAt: now,
      },
    },
    presentedThisSession: {
      ...state.presentedThisSession,
      [proposal.identityKey]: true,
    },
  };
}
