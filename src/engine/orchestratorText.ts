import { findGraphemeSafeOverlapLength } from '../utils/graphemeBoundary';

export function mergeAssistantContinuationText(existingText: string, incomingText: string): string {
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

  const overlapLength = findGraphemeSafeOverlapLength(existingText, incomingText);
  if (overlapLength > 0) {
    return `${existingText}${incomingText.slice(overlapLength)}`;
  }

  return `${existingText}${incomingText}`;
}
