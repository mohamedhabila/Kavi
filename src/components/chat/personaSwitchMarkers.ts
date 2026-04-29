// ---------------------------------------------------------------------------
// Kavi — Persona switch markers
// ---------------------------------------------------------------------------
// Pure derivation of inline persona-switch markers from a conversation's
// `personaEvents` log, per the single-thread/living-memory.
//
// Each event is anchored *before* the first message whose timestamp is
// greater than or equal to the event's `at`. If no such message exists
// (the switch happened after the latest message), the event is skipped —
// the next message added will pick it up on the next render pass.
//
// This module is intentionally side-effect-free; rendering is the caller's
// job. The `displayName` resolver lets callers translate persona ids into
// human-readable names without coupling the helper to the persona store.
// ---------------------------------------------------------------------------

import type { Message, PersonaSwitchEvent } from '../../types';

export interface PersonaSwitchMarker {
  /** Stable id from the underlying event. */
  id: string;
  /** ID of the message this marker should appear *before*. */
  beforeMessageId: string;
  /** Resolved persona display name before the switch (or undefined for first switch). */
  fromName?: string;
  /** Resolved persona display name after the switch. */
  toName: string;
  /** Raw values for callers that want to format their own way. */
  meta: {
    at: number;
    fromId?: string;
    toId: string;
  };
}

export interface ComputePersonaSwitchMarkersOptions {
  /**
   * Resolves a persona id into a human-readable display name. Callers should
   * pass `(id) => personaConfig?.displayName ?? id` (or similar). Returning
   * `undefined` falls back to the raw id.
   */
  resolveDisplayName?: (personaId: string) => string | undefined;
}

export function computePersonaSwitchMarkers(
  messages: ReadonlyArray<Pick<Message, 'id' | 'timestamp'>>,
  events: ReadonlyArray<PersonaSwitchEvent> | undefined,
  options: ComputePersonaSwitchMarkersOptions = {},
): PersonaSwitchMarker[] {
  if (!events || events.length === 0 || messages.length === 0) return [];

  const resolve = options.resolveDisplayName ?? ((id: string) => id);
  const sortedEvents = [...events].sort((a, b) => a.at - b.at);
  const markers: PersonaSwitchMarker[] = [];

  for (const event of sortedEvents) {
    const anchor = messages.find(
      (m) => typeof m.timestamp === 'number' && m.timestamp >= event.at,
    );
    if (!anchor) continue;
    markers.push({
      id: event.id,
      beforeMessageId: anchor.id,
      fromName: event.from ? (resolve(event.from) ?? event.from) : undefined,
      toName: resolve(event.to) ?? event.to,
      meta: { at: event.at, fromId: event.from, toId: event.to },
    });
  }

  return markers;
}
