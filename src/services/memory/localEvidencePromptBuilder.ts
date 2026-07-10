import type { MemoryEpisode } from './episodes/types';
import type { MemoryFact } from './facts/types';
import { expandLocalEvidence } from './localEvidenceExpansion';
import {
  LOCAL_EVIDENCE_PROMPT_PAYLOAD_LIMIT,
  renderLocalEvidencePromptSection,
} from './localEvidencePrompt';
import { deriveLocalEvidenceSources } from './localEvidenceSources';

export const LOCAL_EVIDENCE_PROMPT_OUTCOMES = [
  'not_requested',
  'completed',
  'scope_unavailable',
  'failed',
] as const;
export type LocalEvidencePromptOutcome = (typeof LOCAL_EVIDENCE_PROMPT_OUTCOMES)[number];

export interface LocalEvidencePromptDiagnostics {
  outcome: LocalEvidencePromptOutcome;
  requestedSourceCount: number;
  acceptedSourceCount: number;
  sourceWithEvidenceCount: number;
  emittedEvidenceCount: number;
  promptBudgetDroppedCount: number;
  promptChars: number;
  durationMs: number;
}

export interface BuildLocalEvidencePromptInput {
  facts: ReadonlyArray<MemoryFact>;
  episodes: ReadonlyArray<MemoryEpisode>;
  memoryConversationId?: string;
  sourceThreadId?: string;
  asOf: number;
}

export interface LocalEvidencePromptBuildResult {
  section: string | null;
  diagnostics: LocalEvidencePromptDiagnostics;
}

function emptyDiagnostics(
  outcome: LocalEvidencePromptOutcome,
  requestedSourceCount: number,
  durationMs = 0,
): LocalEvidencePromptDiagnostics {
  return {
    outcome,
    requestedSourceCount,
    acceptedSourceCount: 0,
    sourceWithEvidenceCount: 0,
    emittedEvidenceCount: 0,
    promptBudgetDroppedCount: 0,
    promptChars: 0,
    durationMs,
  };
}

export function buildLocalEvidencePrompt(
  input: BuildLocalEvidencePromptInput,
): LocalEvidencePromptBuildResult {
  const startedAt = Date.now();
  const selectedSources = deriveLocalEvidenceSources(input.facts, input.episodes);
  if (selectedSources.length === 0) {
    return { section: null, diagnostics: emptyDiagnostics('not_requested', 0) };
  }
  if (!input.memoryConversationId || !input.sourceThreadId) {
    return {
      section: null,
      diagnostics: emptyDiagnostics('scope_unavailable', selectedSources.length),
    };
  }

  try {
    const expansion = expandLocalEvidence({
      scope: {
        memoryConversationId: input.memoryConversationId,
        sourceThreadId: input.sourceThreadId,
      },
      selectedSources,
      asOf: input.asOf,
      promptBudgetChars: LOCAL_EVIDENCE_PROMPT_PAYLOAD_LIMIT,
    });
    const section = renderLocalEvidencePromptSection(expansion);
    return {
      section,
      diagnostics: {
        outcome: 'completed',
        requestedSourceCount: expansion.diagnostics.requestedSourceCount,
        acceptedSourceCount: expansion.diagnostics.acceptedSourceCount,
        sourceWithEvidenceCount: expansion.diagnostics.sourceWithEvidenceCount,
        emittedEvidenceCount: expansion.diagnostics.emittedEvidenceCount,
        promptBudgetDroppedCount: expansion.diagnostics.promptBudgetDroppedCount,
        promptChars: section?.length ?? 0,
        durationMs: Math.max(0, Date.now() - startedAt),
      },
    };
  } catch {
    return {
      section: null,
      diagnostics: emptyDiagnostics(
        'failed',
        selectedSources.length,
        Math.max(0, Date.now() - startedAt),
      ),
    };
  }
}
