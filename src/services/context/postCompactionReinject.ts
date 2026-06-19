// ---------------------------------------------------------------------------
// Kavi — Post-compaction reinject
// ---------------------------------------------------------------------------
// Reattaches stable profile blocks and active goals after compaction so the
// working transcript retains graph-owned context (mobile has no AGENTS.md).
// ---------------------------------------------------------------------------

export function buildPostCompactionSystemContent(params: {
  summary: string;
  goalsPromptSection?: string | null;
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

  const goals = params.goalsPromptSection?.trim();
  if (goals) {
    sections.push(goals);
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