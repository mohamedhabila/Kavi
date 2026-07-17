import type { MemoryFactSensitivity } from '../facts/applicabilityProvenance';
import { closedMemoryFactSensitivity } from '../facts/applicabilityProvenance';
import {
  classifyMemoryFactSensitivity,
  classifyMemoryTextSensitivity,
  maxMemoryFactSensitivity,
  type MemorySensitivityInput,
} from '../memorySensitivityPolicy';
import { closedEpisodeSensitivity, type EpisodeSensitivity } from './accessPolicyTypes';
import type { EpisodeSensitivityEvidence } from './types';
import { isExactMemoryProvenanceId } from '../memoryProvenanceIdentity';

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

function hasCompleteClosedTurn(input: {
  messageIds: ReadonlyArray<string>;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string | null;
  evidence: EpisodeSensitivityEvidence;
}): boolean {
  const { evidence, sourceStartMessageId, sourceEndMessageId } = input;
  if (
    !Array.isArray(input.messageIds) ||
    input.messageIds.length === 0 ||
    input.messageIds.length > 128 ||
    !input.messageIds.every(isExactMemoryProvenanceId) ||
    new Set(input.messageIds).size !== input.messageIds.length ||
    sourceStartMessageId !== input.messageIds[0] ||
    sourceEndMessageId !== input.messageIds[input.messageIds.length - 1] ||
    evidence.sourceMessages.length !== input.messageIds.length
  ) {
    return false;
  }
  const allowedRoles = new Set(['system', 'user', 'assistant', 'tool']);
  for (const [index, message] of evidence.sourceMessages.entries()) {
    if (
      !message ||
      typeof message !== 'object' ||
      message.id !== input.messageIds[index] ||
      !allowedRoles.has(message.role) ||
      typeof message.content !== 'string' ||
      (message.truncated !== undefined && typeof message.truncated !== 'boolean')
    ) {
      return false;
    }
  }
  return (
    evidence.sourceMessages[0].role === 'user' &&
    evidence.sourceMessages[evidence.sourceMessages.length - 1].role === 'assistant'
  );
}

/**
 * Derive an episode's immutable lower-bound sensitivity from raw evidence.
 * Missing or malformed closed-turn evidence forbids persistence. Provider
 * summaries and fact candidates can only raise the declared floor.
 */
export function deriveEpisodeSensitivity(input: {
  summary: string;
  messageIds: ReadonlyArray<string>;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string | null;
  evidence?: EpisodeSensitivityEvidence;
  priorSensitivity?: unknown;
}): EpisodeSensitivity | 'restricted' {
  const prior =
    input.priorSensitivity === undefined
      ? 'normal'
      : (closedEpisodeSensitivity(input.priorSensitivity) ?? 'sensitive');
  const evidence = input.evidence;
  if (
    !evidence ||
    !closedMemoryFactSensitivity(evidence.declaredSensitivity) ||
    !Array.isArray(evidence.sourceMessages) ||
    !Array.isArray(evidence.facts) ||
    !hasCompleteClosedTurn({ ...input, evidence })
  ) {
    return 'restricted';
  }
  if (evidence.sourceMessages.some((message) => message.truncated === true)) {
    return 'restricted';
  }

  let factSensitivity = closedMemoryFactSensitivity(evidence.declaredSensitivity)!;
  try {
    for (const fact of evidence.facts) {
      factSensitivity = maxMemoryFactSensitivity(
        factSensitivity,
        classifyMemoryFactSensitivity(fact as MemorySensitivityInput),
      );
    }
  } catch {
    return 'restricted';
  }
  const textSensitivity = maxMemoryFactSensitivity(
    classifyMemoryTextSensitivity(input.summary),
    ...evidence.sourceMessages.map((message) => classifyMemoryTextSensitivity(message.content)),
  );
  if (factSensitivity === 'restricted' || textSensitivity === 'restricted') {
    return 'restricted';
  }
  return maxEpisodeSensitivity(
    prior,
    episodeSensitivityForFact(factSensitivity),
    episodeSensitivityForFact(textSensitivity),
  );
}
