// ---------------------------------------------------------------------------
// Kavi — Episode summary presentation
// ---------------------------------------------------------------------------
// `MemoryEpisode.summary` is prose for a narrative episode but our own
// versioned JSON descriptor for a structural-turn one (see
// `structuralTurnDescriptor.ts`). Every place that shows an episode summary
// to a person or a model — the Memory screen, the automatic-recall prompt
// section — must go through this helper rather than rendering `summary`
// directly, so a structural episode never leaks raw JSON.
//
// The only parsing performed here is the strict versioned parse of our own
// machine format (never a language heuristic); a parse failure falls back to
// the episode's typed entity/tool-name lists, never to the raw string.
// ---------------------------------------------------------------------------

import type { MemoryEpisode } from './types';
import {
  parseStructuralTurnDescriptor,
  type StructuralTurnDescriptor,
} from './structuralTurnDescriptor';

/** Matches the `(key, params?) => string` shape both `i18n.t` and screen `t` props share. */
export type EpisodeSummaryTranslator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

const FRAGMENT_SEPARATOR = ' · ';

function presentStructuralFallback(
  episode: Pick<MemoryEpisode, 'entities' | 'toolNames'>,
  t: EpisodeSummaryTranslator,
): string {
  const details = [...episode.entities, ...episode.toolNames]
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(details));
  const base = t('memory.episodeStructuralFallback');
  return unique.length > 0 ? `${base}${FRAGMENT_SEPARATOR}${unique.join(', ')}` : base;
}

function presentStructuralDescriptor(
  descriptor: StructuralTurnDescriptor,
  t: EpisodeSummaryTranslator,
): string {
  const fragments: string[] = [
    t('memory.episodeStructuralMessages', { count: descriptor.messageCount }),
  ];
  if (descriptor.toolCallCount > 0) {
    fragments.push(
      descriptor.completedToolCallCount === descriptor.toolCallCount
        ? t('memory.episodeStructuralToolCalls', { count: descriptor.toolCallCount })
        : t('memory.episodeStructuralToolCallsPartial', {
            count: descriptor.toolCallCount,
            completed: descriptor.completedToolCallCount,
          }),
    );
  }
  if (descriptor.hasCodeBlock) fragments.push(t('memory.episodeStructuralHasCode'));
  if (descriptor.hasAttachments) fragments.push(t('memory.episodeStructuralHasAttachments'));
  return fragments.join(FRAGMENT_SEPARATOR);
}

/**
 * Renders an episode's summary for display: narrative summaries pass through
 * unchanged; structural-turn summaries are rendered as a localized sentence
 * built from the typed descriptor fields, never as raw JSON.
 */
export function presentEpisodeSummary(
  episode: Pick<MemoryEpisode, 'summary' | 'summaryKind' | 'entities' | 'toolNames'>,
  t: EpisodeSummaryTranslator,
): string {
  if (episode.summaryKind !== 'structural_turn') return episode.summary;
  const descriptor = parseStructuralTurnDescriptor(episode.summary);
  if (!descriptor) return presentStructuralFallback(episode, t);
  return presentStructuralDescriptor(descriptor, t);
}
