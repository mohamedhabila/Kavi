const HEX_ENTITY_PATTERN = /&#x([0-9a-f]+);/gi;
const DECIMAL_ENTITY_PATTERN = /&#(\d+);/gi;

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;?/gi, '&')
    .replace(/&quot;?/gi, '"')
    .replace(/&#39;?/gi, "'")
    .replace(/&lt;?/gi, '<')
    .replace(/&gt;?/gi, '>')
    .replace(HEX_ENTITY_PATTERN, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(DECIMAL_ENTITY_PATTERN, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));
}
