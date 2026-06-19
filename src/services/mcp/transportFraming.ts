import type { JsonRpcNotification, JsonRpcResponse } from './transport';

type ParsedSsePayload = { parsed: true; value: unknown } | { parsed: false };

function parseSseDataPayload(block: string): ParsedSsePayload {
  const dataLines = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .filter(Boolean);

  if (dataLines.length === 0) {
    return { parsed: false };
  }

  try {
    return { parsed: true, value: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { parsed: false };
  }
}

export function parseSseStreamPayload(block: string): ParsedSsePayload {
  return parseSseDataPayload(block);
}

export async function readSseJsonRpcResponse(response: Response): Promise<JsonRpcResponse> {
  const text = await response.text();
  const blocks = text.split(/\n\n+/);

  for (const block of blocks) {
    const payload = parseSseDataPayload(block);
    if (payload.parsed) {
      return payload.value as JsonRpcResponse;
    }
  }

  throw new Error('No valid JSON-RPC response in SSE stream');
}

export function parseJsonOrSsePayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const blocks = text.split(/\n\n+/);
    for (const block of blocks) {
      const payload = parseSseDataPayload(block);
      if (payload.parsed) {
        return payload.value;
      }
    }
  }

  return null;
}

export type McpStreamMessage = JsonRpcResponse | JsonRpcNotification;
