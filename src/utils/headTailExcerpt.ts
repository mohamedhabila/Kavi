export function buildHeadTailExcerpt(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const notice = `\n... [truncated ${value.length - maxChars} chars] ...\n`;
  const available = Math.max(0, maxChars - notice.length);
  const headChars = Math.max(0, Math.floor(available * 0.65));
  const tailChars = Math.max(0, available - headChars);
  return `${value.slice(0, headChars)}${notice}${value.slice(value.length - tailChars)}`;
}
