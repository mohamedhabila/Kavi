export interface UiSymbolMarker {
  glyph: string;
  source: string;
  text: string;
}

const UI_SYMBOL_PATTERN =
  /\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?)*|[★☆✓✔✕✖]/gu;

function comparableDisplayText(value: string | null | undefined): string | null {
  const normalized = value?.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized : null;
}

export function uiFieldDisplayText(input: {
  name: string | null;
  value: string | null;
  options: readonly string[];
}): string | null {
  if (input.options.length !== 1) return null;
  const displayText = comparableDisplayText(input.options[0]);
  if (!displayText) return null;
  const semanticTexts = [input.value, input.name]
    .map(comparableDisplayText)
    .filter((value): value is string => Boolean(value));
  return semanticTexts.includes(displayText) ? null : displayText;
}

export function extractUiSymbolMarkers(
  values: ReadonlyArray<{ source: string; text: string | null | undefined }>,
): UiSymbolMarker[] {
  const markers: UiSymbolMarker[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.text?.trim();
    if (!text) continue;
    for (const match of text.matchAll(UI_SYMBOL_PATTERN)) {
      const glyph = match[0];
      const key = `${glyph}\u0000${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({ glyph, source: value.source, text });
      if (markers.length >= 8) return markers;
    }
  }
  return markers;
}
