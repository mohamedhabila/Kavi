// ---------------------------------------------------------------------------
// Kavi — Post-compaction reinject
// ---------------------------------------------------------------------------
// Reattaches only stable profile blocks after compaction. Graph goals remain
// current-turn state so stale constraints cannot survive in transcript history.
// ---------------------------------------------------------------------------

export function buildPostCompactionSystemContent(params: {
  summary: string;
  profileSections?: ReadonlyArray<string>;
}): string {
  const sections: string[] = [];
  const summary = params.summary.trim();
  if (summary) {
    sections.push(summary);
  }

  const profileSections = (params.profileSections ?? [])
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
  if (profileSections.length > 0) {
    sections.push(`## Persistent Context\n${profileSections.join('\n\n')}`);
  }

  return sections.join('\n\n');
}

export function collectCacheableProfileSections(
  sections: ReadonlyArray<{ text: string; cacheable?: boolean }> | undefined,
): string[] {
  if (!sections?.length) {
    return [];
  }
  return sections
    .filter((section) => section.cacheable === true && section.text.trim().length > 0)
    .map((section) => section.text.trim());
}
