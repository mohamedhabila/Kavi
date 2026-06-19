import { isPlainRecord } from '../json';

export type StreamingPartMerger<TPart> = (
  accumulated: ReadonlyArray<TPart>,
  incoming: ReadonlyArray<TPart>,
) => TPart[];

function readFunctionCall(part: Record<string, any>): Record<string, any> | undefined {
  return isPlainRecord(part.functionCall)
    ? part.functionCall
    : isPlainRecord(part.function_call)
      ? part.function_call
      : undefined;
}

function readPartText(part: Record<string, any>): string {
  return typeof part.text === 'string' ? part.text : '';
}

function isThoughtPart(part: Record<string, any>): boolean {
  return part.thought === true;
}

function isCumulativeTextGrowth(
  existing: Record<string, any>,
  incoming: Record<string, any>,
): boolean {
  const existingText = readPartText(existing);
  const incomingText = readPartText(incoming);
  if (!incomingText || incomingText === existingText) {
    return incomingText.length >= existingText.length;
  }
  return incomingText.startsWith(existingText);
}

function findLastFunctionCallIndex(parts: ReadonlyArray<Record<string, any>>): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (readFunctionCall(parts[index])) {
      return index;
    }
  }
  return -1;
}

function isCumulativeSnapshot(
  accumulated: ReadonlyArray<Record<string, any>>,
  incoming: ReadonlyArray<Record<string, any>>,
): boolean {
  if (incoming.length === 0 || incoming.length < accumulated.length) {
    return false;
  }

  return accumulated.every((part, index) => {
    const next = incoming[index];
    if (!next) {
      return true;
    }

    const existingFunctionCall = readFunctionCall(part);
    const incomingFunctionCall = readFunctionCall(next);
    if (existingFunctionCall || incomingFunctionCall) {
      return Boolean(existingFunctionCall && incomingFunctionCall);
    }

    if (isThoughtPart(part) !== isThoughtPart(next)) {
      return false;
    }

    return isCumulativeTextGrowth(part, next);
  });
}

export function mergeGeminiStreamCandidateParts(
  accumulated: ReadonlyArray<Record<string, any>>,
  incoming: ReadonlyArray<Record<string, any>>,
): Record<string, any>[] {
  if (incoming.length === 0) {
    return [...accumulated];
  }

  if (isCumulativeSnapshot(accumulated, incoming)) {
    return [...incoming];
  }

  const merged = [...accumulated];

  for (let index = 0; index < incoming.length; index += 1) {
    const part = incoming[index];
    const functionCall = readFunctionCall(part);

    if (functionCall) {
      const lastFunctionCallIndex = findLastFunctionCallIndex(merged);
      const replacesPendingToolChoice =
        incoming.length === 1 &&
        lastFunctionCallIndex >= 0 &&
        (index < merged.length ? Boolean(readFunctionCall(merged[index])) : true);

      if (replacesPendingToolChoice) {
        if (index < merged.length && readFunctionCall(merged[index])) {
          merged[index] = part;
        } else {
          merged[lastFunctionCallIndex] = part;
        }
      } else if (index < merged.length && readFunctionCall(merged[index])) {
        merged[index] = part;
      } else {
        merged.push(part);
      }
      continue;
    }

    if (index < merged.length) {
      const existing = merged[index];
      if (readFunctionCall(existing)) {
        merged.push(part);
        continue;
      }

      if (
        isThoughtPart(existing) === isThoughtPart(part) &&
        isCumulativeTextGrowth(existing, part)
      ) {
        merged[index] = part;
        continue;
      }

      if (isThoughtPart(existing) !== isThoughtPart(part)) {
        merged.push(part);
        continue;
      }

      merged[index] = part;
      continue;
    }

    merged.push(part);
  }

  return merged;
}
