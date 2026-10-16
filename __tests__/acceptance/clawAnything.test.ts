import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, type IncomingMessage, type Server } from 'node:http';

import {
  clawAnythingAssistantRecords,
  clawAnythingSystemPrompt,
} from '../../src/acceptance/clawAnything/clawAnythingRun';
import {
  clawAnythingTaskNow,
  parseClawAnythingTaskSpec,
} from '../../src/acceptance/clawAnything/clawAnythingSpec';
import {
  httpClawAnythingDispatch,
  startClawAnythingToolServer,
  type ClawAnythingDispatch,
} from '../../src/acceptance/clawAnything/clawAnythingToolServer';
import { BUILT_IN_PERSONAS, DEFAULT_PERSONA_ID } from '../../src/services/agents/personas';
import type { Message } from '../../src/types/message';

const LIST_MESSAGES = {
  name: 'gmail_list_messages',
  description: 'List inbox messages.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
};

function validSpec(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'T04_T08_demo',
    prompt: 'Consolidate my deadlines.',
    executionDate: '2026-04-05',
    timeoutSeconds: 1200,
    tools: [LIST_MESSAGES],
    dispatchUrl: 'http://127.0.0.1:9000/dispatch',
    activityLogs: [{ path: 'logs/timeline_20260330_20260331.md', content: '# Week' }],
    instructions: '## Activity Logs\n- logs/timeline_20260330_20260331.md',
    outPath: '/tmp/record.json',
    ...overrides,
  };
}

describe('Claw-Anything task spec', () => {
  it('accepts a task as the adapter writes it', () => {
    expect(parseClawAnythingTaskSpec(validSpec())).toEqual(validSpec());
  });

  it.each([
    ['a log outside the workspace', { activityLogs: [{ path: '../x.md', content: '' }] }],
    ['an absolute log path', { activityLogs: [{ path: '/etc/passwd', content: '' }] }],
    ['a dispatcher off this machine', { dispatchUrl: 'http://example.com/dispatch' }],
    ['a dispatcher that is not a URL', { dispatchUrl: 'not a url' }],
    ['a repeated tool', { tools: [LIST_MESSAGES, LIST_MESSAGES] }],
    ['no tools', { tools: [] }],
    [
      'a tool whose input is not an object',
      { tools: [{ ...LIST_MESSAGES, inputSchema: { type: 'string' } }] },
    ],
    ['a tool name with spaces', { tools: [{ ...LIST_MESSAGES, name: 'list messages' }] }],
    ['a day that is not a date', { executionDate: '2026-13-40' }],
    ['a time limit of zero', { timeoutSeconds: 0 }],
    ['an empty request', { prompt: '  ' }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => parseClawAnythingTaskSpec(validSpec(overrides))).toThrow(
      'Invalid Claw-Anything task spec',
    );
  });

  it("puts the task's now at noon UTC on its day, where the mock services freeze it", () => {
    expect(new Date(clawAnythingTaskNow({ executionDate: '2026-04-05' })).toISOString()).toBe(
      '2026-04-05T12:00:00.000Z',
    );
  });
});

describe('clawAnythingSystemPrompt', () => {
  const shipped = BUILT_IN_PERSONAS.find(
    (persona) => persona.id === DEFAULT_PERSONA_ID,
  )!.systemPrompt;

  it("runs Kavi as shipped, with the task's sections after the persona", () => {
    expect(clawAnythingSystemPrompt({ instructions: '## Activity Logs\n- logs/a.md' })).toBe(
      `${shipped}\n\n## Activity Logs\n- logs/a.md`,
    );
  });

  it('is the persona alone for a task without sections', () => {
    expect(clawAnythingSystemPrompt({ instructions: '' })).toBe(shipped);
  });
});

describe('Claw-Anything tool server', () => {
  async function connect(dispatch: ClawAnythingDispatch) {
    const server = await startClawAnythingToolServer([LIST_MESSAGES], dispatch);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    return {
      server,
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("lists the task's tools and passes each call to the dispatcher unchanged", async () => {
    const dispatch = jest.fn<ReturnType<ClawAnythingDispatch>, Parameters<ClawAnythingDispatch>>(
      async () => ({ text: '{"total":2}', isError: false }),
    );
    const { client, close } = await connect(dispatch);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(['gmail_list_messages']);
      const result = await client.callTool({
        name: 'gmail_list_messages',
        arguments: { query: 'invoice' },
      });
      expect(dispatch).toHaveBeenCalledWith('gmail_list_messages', { query: 'invoice' });
      expect(result).toMatchObject({ content: [{ type: 'text', text: '{"total":2}' }] });
      expect(result.isError).toBeFalsy();
    } finally {
      await close();
    }
  });

  it("returns the dispatcher's error results as errors, as the service sent them", async () => {
    const { client, close } = await connect(async () => ({
      text: '{"error":"rate limited"}',
      isError: true,
    }));
    try {
      await expect(
        client.callTool({ name: 'gmail_list_messages', arguments: {} }),
      ).resolves.toMatchObject({
        content: [{ text: '{"error":"rate limited"}' }],
        isError: true,
      });
    } finally {
      await close();
    }
  });

  it('reports a dispatcher fault to the model and records it', async () => {
    const { server, client, close } = await connect(async () => {
      throw new Error('connection refused');
    });
    try {
      await expect(
        client.callTool({ name: 'gmail_list_messages', arguments: {} }),
      ).resolves.toMatchObject({ content: [{ text: 'Error: connection refused' }], isError: true });
      expect(server.errors).toEqual(['dispatch gmail_list_messages: connection refused']);
    } finally {
      await close();
    }
  });

  it('never dispatches a tool the task does not have', async () => {
    const dispatch = jest.fn<ReturnType<ClawAnythingDispatch>, Parameters<ClawAnythingDispatch>>();
    const { client, close } = await connect(dispatch);
    try {
      await expect(
        client.callTool({ name: 'calendar_delete_event', arguments: {} }),
      ).resolves.toMatchObject({ isError: true });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

describe('httpClawAnythingDispatch', () => {
  let server: Server;
  let url: string;
  let received: { authorization?: string; body: string }[];
  let reply: { status: number; body: string };

  beforeEach(async () => {
    received = [];
    reply = { status: 200, body: JSON.stringify({ text: 'ok', isError: false }) };
    server = createServer((request: IncomingMessage, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push({ authorization: request.headers.authorization, body });
        response.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    url = `http://127.0.0.1:${address.port}/dispatch`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('posts the call with the bearer token and reads the reply', async () => {
    await expect(
      httpClawAnythingDispatch(url, 'secret')('todo_list_tasks', { limit: 5 }),
    ).resolves.toEqual({
      text: 'ok',
      isError: false,
    });
    expect(received).toEqual([
      { authorization: 'Bearer secret', body: '{"name":"todo_list_tasks","input":{"limit":5}}' },
    ]);
  });

  it('fails on a refused request', async () => {
    reply = { status: 401, body: '{"error":"unauthorized"}' };
    await expect(httpClawAnythingDispatch(url, 'wrong')('todo_list_tasks', {})).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('fails on a reply without text and isError', async () => {
    reply = { status: 200, body: '{"text":"ok"}' };
    await expect(httpClawAnythingDispatch(url, 'secret')('todo_list_tasks', {})).rejects.toThrow(
      'without text and isError',
    );
  });
});

describe('clawAnythingAssistantRecords', () => {
  function message(overrides: Partial<Message>): Message {
    return { id: 'm', role: 'assistant', content: '', timestamp: 0, ...overrides };
  }

  it("gives each step's calls the benchmark's tool names, inputs and results", () => {
    const records = clawAnythingAssistantRecords([
      message({ role: 'user', content: 'Consolidate my deadlines.' }),
      message({
        content: 'Checking your calendar.',
        toolCalls: [
          {
            id: 'c1',
            name: 'mcp__apps__calendar_list_events',
            arguments: '{"date":"2026-03-24","days":8}',
            status: 'completed',
            result: '{"events":[]}',
          },
          {
            id: 'c2',
            name: 'workspace_read',
            arguments: 'not json',
            status: 'failed',
            error: 'missing file',
          },
        ],
      }),
      message({ role: 'tool', toolCallId: 'c1', content: 'ignored: the call holds its result' }),
      message({ content: 'Here is what collides.' }),
    ]);

    expect(records).toEqual([
      {
        text: 'Checking your calendar.',
        toolCalls: [
          {
            id: 'c1',
            name: 'calendar_list_events',
            input: { date: '2026-03-24', days: 8 },
            result: '{"events":[]}',
            isError: false,
          },
          {
            id: 'c2',
            name: 'workspace_read',
            input: { unparsed: 'not json' },
            result: 'missing file',
            isError: true,
          },
        ],
      },
      { text: 'Here is what collides.', toolCalls: [] },
    ]);
  });

  it('takes a result from its tool message when the call does not hold one', () => {
    const [record] = clawAnythingAssistantRecords([
      message({
        toolCalls: [
          { id: 'c1', name: 'mcp__apps__todo_list_tasks', arguments: '', status: 'completed' },
        ],
      }),
      message({ role: 'tool', toolCallId: 'c1', content: '{"error":"busy"}', isError: true }),
    ]);

    expect(record?.toolCalls[0]).toEqual({
      id: 'c1',
      name: 'todo_list_tasks',
      input: {},
      result: '{"error":"busy"}',
      isError: true,
    });
  });
});
