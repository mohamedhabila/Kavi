// ---------------------------------------------------------------------------
// Kavi — E2E mail integration (an in-process MCP server)
// ---------------------------------------------------------------------------
// A seeded inbox served over MCP, the way a person's mail reaches Kavi through an
// integration: search, read, draft a reply, send a draft. What the model wrote and sent is
// recorded on the scenario phone, so the scenario's device rubrics grade it.

import { Server as McpProtocolServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';

export type E2EMailMessage = Readonly<{
  id: string;
  from: Readonly<{ name: string; email: string }>;
  subject: string;
  body: string;
  /** ISO time it arrived. */
  receivedAt: string;
}>;

export type E2EMailReply = Readonly<{
  draftId: string;
  inReplyTo: string;
  body: string;
  sent: boolean;
}>;

export type RunningE2EMailServer = Readonly<{
  url: string;
  /** Protocol and transport errors the server saw. */
  errors: ReadonlyArray<string>;
  close: () => Promise<void>;
}>;

const MAX_SEARCH_RESULTS = 20;

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function preview(message: E2EMailMessage) {
  return {
    id: message.id,
    from: message.from,
    subject: message.subject,
    receivedAt: message.receivedAt,
    snippet: message.body.slice(0, 120),
  };
}

function matches(message: E2EMailMessage, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [message.from.name, message.from.email, message.subject, message.body].some((field) =>
    field.toLocaleLowerCase().includes(needle),
  );
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

const TOOLS = [
  {
    name: 'mail_search',
    description:
      'Search the inbox; newest first. The query matches sender, subject and text; empty lists the latest mail.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1 } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mail_read',
    description: 'Read one email in full by its id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mail_draft_reply',
    description: 'Write a reply to an email as a draft; nothing is sent until mail_send_draft.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message_id: { type: 'string', minLength: 1 },
        body: { type: 'string', minLength: 1 },
      },
      required: ['message_id', 'body'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'mail_send_draft',
    description: 'Send a draft written with mail_draft_reply.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { draft_id: { type: 'string', minLength: 1 } },
      required: ['draft_id'],
    },
    annotations: { readOnlyHint: false },
  },
];

/**
 * Serves `messages` at a local URL until closed. `onReply` hears every draft written and
 * every draft sent, with its state at that moment.
 */
export async function startE2EMailServer(
  messages: ReadonlyArray<E2EMailMessage>,
  onReply: (reply: E2EMailReply) => void,
): Promise<RunningE2EMailServer> {
  const errors: string[] = [];
  const drafts = new Map<string, E2EMailReply>();
  const newestFirst = [...messages].sort(
    (left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
  );
  const protocolServer = new McpProtocolServer(
    { name: 'e2e-mail', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  protocolServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  protocolServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args =
      request.params.arguments && typeof request.params.arguments === 'object'
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    try {
      switch (request.params.name) {
        case 'mail_search': {
          const query = typeof args.query === 'string' ? args.query : '';
          const limit =
            typeof args.limit === 'number' && args.limit > 0
              ? Math.min(MAX_SEARCH_RESULTS, Math.floor(args.limit))
              : MAX_SEARCH_RESULTS;
          const found = newestFirst.filter((message) => matches(message, query)).slice(0, limit);
          return textResult({ count: found.length, messages: found.map(preview) });
        }
        case 'mail_read': {
          const message = messages.find((candidate) => candidate.id === requireString(args, 'id'));
          return message
            ? textResult(message)
            : textResult({ status: 'not_found', id: args.id }, true);
        }
        case 'mail_draft_reply': {
          const inReplyTo = requireString(args, 'message_id');
          if (!messages.some((message) => message.id === inReplyTo)) {
            return textResult({ status: 'not_found', id: inReplyTo }, true);
          }
          const draft: E2EMailReply = {
            draftId: `draft-${drafts.size + 1}`,
            inReplyTo,
            body: requireString(args, 'body'),
            sent: false,
          };
          drafts.set(draft.draftId, draft);
          onReply(draft);
          return textResult({ status: 'drafted', draftId: draft.draftId, inReplyTo });
        }
        case 'mail_send_draft': {
          const draft = drafts.get(requireString(args, 'draft_id'));
          if (!draft) return textResult({ status: 'not_found', id: args.draft_id }, true);
          const sent = { ...draft, sent: true };
          drafts.set(sent.draftId, sent);
          onReply(sent);
          return textResult({ status: 'sent', draftId: sent.draftId, inReplyTo: sent.inReplyTo });
        }
        default:
          return textResult({ status: 'unknown_tool', name: request.params.name }, true);
      }
    } catch (error) {
      return textResult(
        {
          status: 'invalid_arguments',
          message: error instanceof Error ? error.message : String(error),
        },
        true,
      );
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
    throw new Error('The e2e mail server has no address.');
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
