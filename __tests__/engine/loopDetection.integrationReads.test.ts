import {
  buildIterationSemanticProgressFingerprint,
  buildToolMultisetKey,
  detectLoops,
  hashResult,
  type IterationProgressSignature,
  type ToolCallRecord,
} from '../../src/engine/loopDetection';
import { mcpToolToDefinition } from '../../src/services/mcp/bridge';
import { mcpManager } from '../../src/services/mcp/manager';

// Traced live (pwglm2, pw-es-mail-reply-latest): GLM searched a connected mail integration
// three times with different queries — nothing, then the inbox, then nothing — and the run
// was stopped as "repeating the same step without making progress" one call before it
// replied. A trusted read-only integration tool was classified by its name alone, so it
// counted as neither a read (no information fingerprint) nor an effect (no receipt).

const SEARCH = 'mcp__mail__mail_search';
const EMPTY = JSON.stringify({ count: 0, messages: [] });
const INBOX = JSON.stringify({ count: 5, messages: [{ id: 'm-5', subject: 'Rent' }] });

function connectMail(annotations?: { readOnlyHint: boolean }) {
  jest.spyOn(mcpManager, 'captureRuntimeToolBinding').mockReturnValue({
    declaration: mcpToolToDefinition({
      serverId: 'mail',
      serverName: 'Mail',
      tool: {
        name: 'mail_search',
        description: 'Search the inbox',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        ...(annotations ? { annotations } : {}),
      },
      trustToolAnnotations: annotations !== undefined,
    }),
  } as never);
}

function search(query: string, result: string, index: number): ToolCallRecord {
  return {
    name: SEARCH,
    arguments: JSON.stringify({ query }),
    status: 'completed',
    result,
    resultHash: hashResult(result),
    timestamp: index,
  };
}

/** The history and per-iteration signatures the graph records for one search per iteration. */
function runOf(calls: ReadonlyArray<ToolCallRecord>) {
  const signatures: IterationProgressSignature[] = calls.map((call) => ({
    toolMultisetKey: buildToolMultisetKey([call.name]),
    effectReceiptCount: 0,
    semanticProgressFingerprint: buildIterationSemanticProgressFingerprint([call]),
  }));
  return detectLoops([...calls], signatures);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('searching a connected integration', () => {
  it('is progress when each search asks something new', () => {
    connectMail({ readOnlyHint: true });

    const result = runOf([
      search('casero alquiler renta', EMPTY, 1),
      search('', INBOX, 2),
      search('Rent for this month Rui', EMPTY, 3),
    ]);

    expect(result.loopDetected).toBe(false);
  });

  it('is held to the rule a built-in read is', () => {
    const queries = ['casero', 'alquiler', 'renta'];
    connectMail({ readOnlyHint: true });
    const integration = runOf(queries.map((query, index) => search(query, EMPTY, index)));
    const builtIn = runOf(
      queries.map((query, index) => ({ ...search(query, EMPTY, index), name: 'web_search' })),
    );

    expect(integration).toEqual(builtIn);
    expect(integration.loopDetected).toBe(false);
  });

  it('is still stopped when the same search repeats', () => {
    connectMail({ readOnlyHint: true });

    const result = runOf([
      search('rent', EMPTY, 1),
      search('rent', EMPTY, 2),
      search('rent', EMPTY, 3),
    ]);

    expect(result.loopDetected).toBe(true);
  });
});
