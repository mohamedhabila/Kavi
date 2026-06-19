import { isGemini3Model } from '../../catalog/providerCapabilities';
import { isPlainRecord } from '../../core/json';
import { extractGeminiThoughtSignature } from '../../core/reasoningExtraction';
import { readTrimmedString } from '../../core/toolCallNormalization';
import { readGeminiFunctionCallId } from './contentParts';

export type GeminiContentEntry = { role: 'user' | 'model'; parts: any[] };

export const GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE =
  'context_engineering_is_the_way to_go';

function isGeminiFunctionCallPart(part: unknown): part is Record<string, any> {
  return isPlainRecord(part) && isPlainRecord(part.functionCall);
}

function isGeminiFunctionResponsePart(part: unknown): part is Record<string, any> {
  return isPlainRecord(part) && isPlainRecord(part.functionResponse);
}

function readGeminiFunctionResponseId(part: unknown): string | undefined {
  if (!isGeminiFunctionResponsePart(part)) {
    return undefined;
  }
  return readTrimmedString(part.functionResponse.id);
}

function readGeminiFunctionPartName(part: Record<string, any>): string | undefined {
  const payload = isPlainRecord(part.functionCall)
    ? part.functionCall
    : isPlainRecord(part.functionResponse)
      ? part.functionResponse
      : undefined;
  return readTrimmedString(payload?.name);
}

function hasCompatibleGeminiFunctionName(
  callPart: Record<string, any>,
  responsePart: Record<string, any>,
): boolean {
  const callName = readGeminiFunctionPartName(callPart);
  const responseName = readGeminiFunctionPartName(responsePart);
  return !callName || !responseName || callName === responseName;
}

function matchCompleteGeminiFunctionResponses(args: {
  callParts: ReadonlyArray<Record<string, any>>;
  responseParts: ReadonlyArray<Record<string, any>>;
}): { calls: Record<string, any>[]; responses: Record<string, any>[] } | null {
  if (args.callParts.length === 0 || args.callParts.length !== args.responseParts.length) {
    return null;
  }

  const callIds = args.callParts.map((part) => readGeminiFunctionCallId(part.functionCall));
  const responseIds = args.responseParts.map((part) => readGeminiFunctionResponseId(part));
  const usesIds = callIds.some(Boolean) || responseIds.some(Boolean);

  if (!usesIds) {
    const namesMatch = args.callParts.every((callPart, index) =>
      hasCompatibleGeminiFunctionName(callPart, args.responseParts[index]),
    );
    return namesMatch
      ? {
          calls: [...args.callParts],
          responses: [...args.responseParts],
        }
      : null;
  }

  if (callIds.some((id) => !id) || responseIds.some((id) => !id)) {
    return null;
  }

  const responsesById = new Map<string, Record<string, any>>();
  for (const responsePart of args.responseParts) {
    const id = readGeminiFunctionResponseId(responsePart);
    if (!id || responsesById.has(id)) {
      return null;
    }
    responsesById.set(id, responsePart);
  }

  const matchedResponses: Record<string, any>[] = [];
  for (const callPart of args.callParts) {
    const id = readGeminiFunctionCallId(callPart.functionCall);
    const responsePart = id ? responsesById.get(id) : undefined;
    if (!responsePart || !hasCompatibleGeminiFunctionName(callPart, responsePart)) {
      return null;
    }
    matchedResponses.push(responsePart);
  }

  return {
    calls: [...args.callParts],
    responses: matchedResponses,
  };
}

function ensureGeminiFunctionCallSignatures(
  model: string,
  callParts: ReadonlyArray<Record<string, any>>,
): Record<string, any>[] {
  if (!isGemini3Model(model) || callParts.length === 0) {
    return [...callParts];
  }

  const [firstCall, ...rest] = callParts;
  if (extractGeminiThoughtSignature(firstCall)) {
    return [...callParts];
  }

  return [
    {
      ...firstCall,
      thoughtSignature: GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE,
    },
    ...rest,
  ];
}

function isGeminiThoughtCarrierPart(part: unknown): boolean {
  if (!isPlainRecord(part) || isGeminiFunctionCallPart(part)) {
    return false;
  }

  const record: Record<string, any> = part;
  return record.thought === true || Boolean(extractGeminiThoughtSignature(record));
}

function keepModelPartsAfterDroppedFunctionCalls(parts: ReadonlyArray<unknown>): any[] {
  return parts.filter(
    (part) => !isGeminiFunctionCallPart(part) && !isGeminiThoughtCarrierPart(part),
  );
}

export function repairGeminiToolTurnContents(
  model: string,
  contents: ReadonlyArray<GeminiContentEntry>,
): GeminiContentEntry[] {
  const repaired: GeminiContentEntry[] = [];

  for (let index = 0; index < contents.length; index += 1) {
    const entry = contents[index];
    const functionCallParts = entry.parts.filter(isGeminiFunctionCallPart);

    if (entry.role === 'model' && functionCallParts.length > 0) {
      const nonFunctionCallParts = entry.parts.filter((part) => !isGeminiFunctionCallPart(part));
      const safeDroppedCallParts = keepModelPartsAfterDroppedFunctionCalls(entry.parts);
      const nextEntry = contents[index + 1];

      if (nextEntry?.role === 'user') {
        const functionResponseParts = nextEntry.parts.filter(isGeminiFunctionResponsePart);
        const nonFunctionResponseParts = nextEntry.parts.filter(
          (part) => !isGeminiFunctionResponsePart(part),
        );

        if (functionResponseParts.length > 0) {
          const matched = matchCompleteGeminiFunctionResponses({
            callParts: functionCallParts,
            responseParts: functionResponseParts,
          });
          if (matched) {
            repaired.push({
              role: 'model',
              parts: [
                ...nonFunctionCallParts,
                ...ensureGeminiFunctionCallSignatures(model, matched.calls),
              ],
            });
            repaired.push({
              role: 'user',
              parts: matched.responses,
            });
            if (nonFunctionResponseParts.length > 0) {
              repaired.push({
                role: 'user',
                parts: nonFunctionResponseParts,
              });
            }
            index += 1;
            continue;
          }

          if (safeDroppedCallParts.length > 0) {
            repaired.push({
              role: 'model',
              parts: safeDroppedCallParts,
            });
          }
          if (nonFunctionResponseParts.length > 0) {
            repaired.push({
              role: 'user',
              parts: nonFunctionResponseParts,
            });
          }
          index += 1;
          continue;
        }
      }

      if (safeDroppedCallParts.length > 0) {
        repaired.push({
          role: 'model',
          parts: safeDroppedCallParts,
        });
      }
      continue;
    }

    if (entry.role === 'user' && entry.parts.some(isGeminiFunctionResponsePart)) {
      const nonFunctionResponseParts = entry.parts.filter(
        (part) => !isGeminiFunctionResponsePart(part),
      );
      if (nonFunctionResponseParts.length > 0) {
        repaired.push({
          role: 'user',
          parts: nonFunctionResponseParts,
        });
      }
      continue;
    }

    if (entry.parts.length > 0) {
      repaired.push(entry);
    }
  }

  return repaired;
}
