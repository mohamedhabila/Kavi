// ---------------------------------------------------------------------------
// Kavi — Claw-Anything: the task's tools, served to Kavi as an MCP integration
// ---------------------------------------------------------------------------
// The person's apps (mail, calendar, notes…) reach Kavi the way any connected integration
// does: an MCP server over Streamable HTTP. Each call is passed unchanged to the benchmark's
// own dispatcher, which calls the mock service and records the call for grading, so its
// results (including injected 429/500 errors) are exactly what every other harness sees.

import { Server as McpProtocolServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';

import type { ClawAnythingTool } from './clawAnythingSpec';

/** The dispatcher's own HTTP client waits 30 s per call; this covers it plus its bookkeeping. */
const DISPATCH_TIMEOUT_MS = 45_000;

export type ClawAnythingDispatchReply = Readonly<{ text: string; isError: boolean }>;

export type RunningClawAnythingToolServer = Readonly<{
  url: string;
  /** Protocol, transport and dispatch faults (not tool errors, which the model sees). */
  errors: ReadonlyArray<string>;
  close: () => Promise<void>;
}>;

export type ClawAnythingDispatch = (
  name: string,
  input: Readonly<Record<string, unknown>>,
) => Promise<ClawAnythingDispatchReply>;

function parseDispatchReply(value: unknown): ClawAnythingDispatchReply {
  const reply = value as { text?: unknown; isError?: unknown } | null;
  if (!reply || typeof reply.text !== 'string' || typeof reply.isError !== 'boolean') {
    throw new Error('The dispatcher replied without text and isError.');
  }
  return { text: reply.text, isError: reply.isError };
}

/** Sends each call to the benchmark dispatcher at [url], authorized by [token]. */
export function httpClawAnythingDispatch(url: string, token: string): ClawAnythingDispatch {
  return async (name, input) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name, input }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`The dispatcher answered HTTP ${response.status}: ${await response.text()}`);
    }
    return parseDispatchReply(await response.json());
  };
}

/** Serves [tools] at a local URL until closed; every call goes through [dispatch]. */
export async function startClawAnythingToolServer(
  tools: ReadonlyArray<ClawAnythingTool>,
  dispatch: ClawAnythingDispatch,
): Promise<RunningClawAnythingToolServer> {
  const errors: string[] = [];
  const known = new Set(tools.map((tool) => tool.name));
  const protocolServer = new McpProtocolServer(
    { name: 'claw-anything', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  protocolServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: 'object'; [key: string]: unknown },
    })),
  }));
  protocolServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const input =
      request.params.arguments && typeof request.params.arguments === 'object'
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    if (!known.has(name)) {
      return { content: [{ type: 'text' as const, text: `Unknown tool ${name}.` }], isError: true };
    }
    try {
      const reply = await dispatch(name, input);
      return {
        content: [{ type: 'text' as const, text: reply.text }],
        ...(reply.isError ? { isError: true } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`dispatch ${name}: ${message}`);
      return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  });
  protocolServer.onerror = (error) => errors.push(`protocol: ${error.message}`);
  transport.onerror = (error) => errors.push(`transport: ${error.message}`);
  await protocolServer.connect(transport);
  const httpServer = createServer((request, response) => {
    if (request.url !== '/mcp' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    transport.handleRequest(request, response).catch((error: unknown) => {
      errors.push(`request: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    await protocolServer.close();
    await closeHttpServer(httpServer);
    throw new Error('The Claw-Anything tool server has no address.');
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    errors,
    close: async () => {
      await protocolServer.close();
      await closeHttpServer(httpServer);
    },
  };
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
