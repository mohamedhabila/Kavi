import type { MemoryFactSensitivity } from '../facts/applicabilityProvenance';
import {
  classifyMemoryFactSensitivity,
  maxMemoryFactSensitivity,
  type MemorySensitivityInput,
} from '../memorySensitivityPolicy';
import { closedEpisodeSensitivity, type EpisodeSensitivity } from './accessPolicyTypes';
import type { EpisodeSensitivityEvidence } from './types';

const EPISODE_SENSITIVITY_RANK: Readonly<Record<EpisodeSensitivity, number>> = {
  normal: 0,
  private: 1,
  sensitive: 2,
};

export function maxEpisodeSensitivity(
  ...levels: readonly EpisodeSensitivity[]
): EpisodeSensitivity {
  return levels.reduce<EpisodeSensitivity>(
    (maximum, level) =>
      EPISODE_SENSITIVITY_RANK[level] > EPISODE_SENSITIVITY_RANK[maximum] ? level : maximum,
    'normal',
  );
}

function episodeSensitivityForFact(level: MemoryFactSensitivity): EpisodeSensitivity {
  if (level === 'personal') return 'private';
  if (level === 'sensitive' || level === 'restricted') return 'sensitive';
  return 'normal';
}

function classifyEpisodeText(text: string): MemoryFactSensitivity {
  return classifyMemoryFactSensitivity({
    predicate: text,
    objectText: text,
    sourceSummary: text,
    memoryKind: 'summary',
  });
}

function hasCompleteClosedTurn(input: {
  messageIds: ReadonlyArray<string>;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string | null;
  evidence: EpisodeSensitivityEvidence;
}): boolean {
  const { evidence, sourceStartMessageId, sourceEndMessageId } = input;
  if (!sourceStartMessageId || !sourceEndMessageId) return false;
  const knownMessageIds = new Set(input.messageIds);
  const evidenceIds = new Set<string>();
  let hasSourceUser = false;
  let hasSourceAssistant = false;
  for (const message of evidence.sourceMessages) {
    if (
      !message.id ||
      evidenceIds.has(message.id) ||
      !knownMessageIds.has(message.id) ||
      typeof message.content !== 'string' ||
      (message.truncated !== undefined && typeof message.truncated !== 'boolean')
    ) {
      return false;
    }
    evidenceIds.add(message.id);
    if (message.id === sourceStartMessageId && message.role === 'user') hasSourceUser = true;
    if (message.id === sourceEndMessageId && message.role === 'assistant') {
      hasSourceAssistant = true;
    }
  }
  return (
    hasSourceUser &&
    hasSourceAssistant &&
    evidenceIds.size === knownMessageIds.size &&
    input.messageIds.every((messageId) => evidenceIds.has(messageId))
  );
}

/**
 * Derive an episode's immutable lower-bound sensitivity from raw evidence.
 * Missing or malformed closed-turn evidence is sensitive by default. Provider
 * summaries and fact candidates can only raise this classification.
 */
export function deriveEpisodeSensitivity(input: {
  summary: string;
  messageIds: ReadonlyArray<string>;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string | null;
  evidence?: EpisodeSensitivityEvidence;
  priorSensitivity?: unknown;
}): EpisodeSensitivity {
  const prior =
    input.priorSensitivity === undefined
      ? 'normal'
      : (closedEpisodeSensitivity(input.priorSensitivity) ?? 'sensitive');
  const evidence = input.evidence;
  if (!evidence || !hasCompleteClosedTurn({ ...input, evidence })) {
    return maxEpisodeSensitivity(prior, 'sensitive');
  }
  if (evidence.sourceMessages.some((message) => message.truncated === true)) {
    return maxEpisodeSensitivity(prior, 'sensitive');
  }

  let factSensitivity: MemoryFactSensitivity = 'normal';
  for (const fact of evidence.facts) {
    factSensitivity = maxMemoryFactSensitivity(
      factSensitivity,
      classifyMemoryFactSensitivity(fact as MemorySensitivityInput),
    );
  }
  const textSensitivity = maxMemoryFactSensitivity(
    classifyEpisodeText(input.summary),
    ...evidence.sourceMessages.map((message) => classifyEpisodeText(message.content)),
  );
  return maxEpisodeSensitivity(
    prior,
    episodeSensitivityForFact(factSensitivity),
    episodeSensitivityForFact(textSensitivity),
  );
}
