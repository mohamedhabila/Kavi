function findAssistantContinuationOverlap(existingText: string, incomingText: string): number {
  const maxOverlap = Math.min(existingText.length, incomingText.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (existingText.slice(-overlapLength) === incomingText.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}

export function mergeAssistantContinuationText(
  existingText: string,
  incomingText: string,
): string {
  if (!existingText) {
    return incomingText;
  }

  if (!incomingText) {
    return existingText;
  }

  if (incomingText.startsWith(existingText)) {
    return incomingText;
  }

  if (existingText.startsWith(incomingText)) {
    return existingText;
  }

  const overlapLength = findAssistantContinuationOverlap(existingText, incomingText);
  if (overlapLength > 0) {
    return `${existingText}${incomingText.slice(overlapLength)}`;
  }

  return `${existingText}${incomingText}`;
}
