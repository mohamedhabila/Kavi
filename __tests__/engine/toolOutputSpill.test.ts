import { DEFAULT_FETCH_MAX_CHARS } from '../../src/engine/tools/web-fetch';
import {
  maybeSpillToolOutput,
  resolveToolOutputSpillThreshold,
  TOOL_OUTPUT_DISCOVERY_SPILL_CHAR_THRESHOLD,
  TOOL_OUTPUT_SPILL_CHAR_THRESHOLD,
  TOOL_OUTPUT_SPILL_PREVIEW_CHARS,
} from '../../src/engine/tools/toolOutputSpill';
import { writeConversationWorkspaceTextFile } from '../../src/services/conversationWorkspace/files';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../helpers/graphemeTestFixtures';

jest.mock('../../src/services/conversationWorkspace/files', () => ({
  writeConversationWorkspaceTextFile: jest.fn().mockResolvedValue({
    path: '.kavi/spill/read_file-1.txt',
    size: 9000,
    uri: 'file://spill',
  }),
}));

const mockedWrite = writeConversationWorkspaceTextFile as jest.MockedFunction<
  typeof writeConversationWorkspaceTextFile
>;

describe('toolOutputSpill', () => {
  beforeEach(() => {
    mockedWrite.mockClear();
  });

  it('returns inline output when under the spill threshold', async () => {
    const result = 'small payload';
    const spilled = await maybeSpillToolOutput({
      result,
      conversationId: 'conv-1',
      toolName: 'read_file',
      timestamp: 1,
    });

    expect(spilled.spilled).toBe(false);
    expect(spilled.payload).toBe(result);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('spills oversized output to the workspace and returns a pointer preview', async () => {
    const result = 'x'.repeat(TOOL_OUTPUT_SPILL_CHAR_THRESHOLD + 64);
    const spilled = await maybeSpillToolOutput({
      result,
      conversationId: 'conv-1',
      toolName: 'read_file',
      timestamp: 42,
    });

    expect(spilled.spilled).toBe(true);
    expect(mockedWrite).toHaveBeenCalledWith('conv-1', '.kavi/spill/read_file-42.txt', result);
    expect(spilled.preview.length).toBeLessThanOrEqual(TOOL_OUTPUT_SPILL_PREVIEW_CHARS + 1);
    expect(JSON.parse(spilled.payload)).toEqual(
      expect.objectContaining({
        status: 'spilled',
        path: '.kavi/spill/read_file-42.txt',
        preview: spilled.preview,
      }),
    );
  });

  it('keeps compact delegation terminal metadata beside an oversized spill pointer', async () => {
    const result = JSON.stringify({
      status: 'completed',
      sessions: [
        {
          sessionId: 'sub-worker',
          status: 'completed',
          completionState: 'verified_success',
          workstreamId: 'worker-goal',
          output: `Verified worker report ${'x'.repeat(TOOL_OUTPUT_SPILL_CHAR_THRESHOLD)}`,
          toolsUsed: ['read_file'],
          iterations: 12,
          depth: 1,
        },
      ],
    });

    const spilled = await maybeSpillToolOutput({
      result,
      conversationId: 'conv-1',
      toolName: 'sessions_wait',
      timestamp: 42,
    });
    const payload = JSON.parse(spilled.payload) as Record<string, any>;

    expect(spilled.spilled).toBe(true);
    expect(payload.structuralResult).toMatchObject({
      version: 1,
      kind: 'delegation_sessions',
      sessions: [
        {
          sessionId: 'sub-worker',
          status: 'completed',
          completionState: 'verified_success',
          workstreamId: 'worker-goal',
          toolsUsed: ['read_file'],
          iterations: 12,
        },
      ],
    });
    expect(payload.structuralResult.sessions[0].outputPreview.length).toBeLessThanOrEqual(600);
  });

  it('keeps bounded discovery metadata inline so agents can discover tools', async () => {
    const result = JSON.stringify({
      mode: 'search',
      tools: [
        {
          name: 'sessions_spawn',
          description: 'Start a worker session.',
          activation: { name: 'sessions_spawn', eligible: true, callableNow: true },
        },
      ],
      padding: 'x'.repeat(TOOL_OUTPUT_SPILL_CHAR_THRESHOLD + 64),
    });

    const spilled = await maybeSpillToolOutput({
      result,
      conversationId: 'conv-1',
      toolName: 'tool_catalog',
      timestamp: 42,
    });

    expect(spilled.spilled).toBe(false);
    expect(spilled.payload).toBe(result);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('still spills discovery metadata above the discovery inline budget', async () => {
    const result = JSON.stringify({
      mode: 'search',
      tools: [],
      padding: 'x'.repeat(TOOL_OUTPUT_DISCOVERY_SPILL_CHAR_THRESHOLD + 64),
    });

    const spilled = await maybeSpillToolOutput({
      result,
      conversationId: 'conv-1',
      toolName: 'tool_catalog',
      timestamp: 42,
    });

    expect(spilled.spilled).toBe(true);
    expect(mockedWrite).toHaveBeenCalledWith('conv-1', '.kavi/spill/tool_catalog-42.txt', result);
  });
});

describe('spill threshold', () => {
  // Traced on Sonnet 5.5 (Claw-Anything): at 8 KB a list of the person's notes or mail
  // spilled and the model answered from its first 1,200 characters (41 of 474 results).
  it('hands the model a 30,000-character integration result whole', async () => {
    const result = JSON.stringify({ notes: 'n'.repeat(30_000) });

    const spilled = await maybeSpillToolOutput({
      result,
      conversationId: 'conv-1',
      toolName: 'mcp__apps__notes_list',
      contextWindowTokens: 400_000,
      timestamp: 1,
    });

    expect(spilled).toMatchObject({ spilled: false, payload: result });
  });

  it("spills past Claude Code's documented 50,000 characters", () => {
    expect(resolveToolOutputSpillThreshold('python')).toBe(50_000);
    expect(resolveToolOutputSpillThreshold('ssh_exec', 400_000)).toBe(50_000);
  });

  it('keeps a default-sized web_fetch window inline', () => {
    expect(resolveToolOutputSpillThreshold('web_fetch')).toBeGreaterThanOrEqual(
      DEFAULT_FETCH_MAX_CHARS,
    );
  });

  it('spills sooner for a model whose window holds less', async () => {
    // A quarter of an 8k on-device window, at two characters a token.
    expect(resolveToolOutputSpillThreshold('python', 8_192)).toBe(4_096);

    const spilled = await maybeSpillToolOutput({
      result: 'x'.repeat(10_000),
      conversationId: 'conv-1',
      toolName: 'python',
      contextWindowTokens: 8_192,
      timestamp: 7,
    });

    expect(spilled.spilled).toBe(true);
  });
});

describe('spill preview content selection', () => {
  const CONVERSATION_ID = 'conv-preview';

  async function spill(result: string) {
    return maybeSpillToolOutput({
      result,
      conversationId: CONVERSATION_ID,
      toolName: 'python',
      timestamp: 1,
    });
  }

  it('previews the payload content instead of the JSON envelope', async () => {
    // A head slice of the raw JSON spends the whole budget on the wrapper and the top
    // of the page, which is navigation chrome. The model then learns nothing and reads
    // the spill file back every time, so the offload costs a turn instead of saving one.
    const article = `Titan has a mean radius of 2,574.73 km. ${'body '.repeat(12_000)}`;
    const payload = JSON.stringify({
      fetches: [{ url: 'https://en.wikipedia.org/wiki/Titan_(moon)', content: article }],
    });

    const spilled = await spill(payload);

    expect(spilled.spilled).toBe(true);
    expect(spilled.preview).toContain('mean radius of 2,574.73 km');
    expect(spilled.preview).not.toContain('"fetches"');
  });

  it('falls back to the raw payload when the meaning is structural', async () => {
    // Many short fields and no long string: the shape is the information, so the
    // envelope is the more useful preview.
    const payload = JSON.stringify({
      rows: Array.from({ length: 3000 }, (_, index) => ({ id: index, ok: true })),
    });

    const spilled = await spill(payload);

    expect(spilled.spilled).toBe(true);
    expect(spilled.preview.startsWith('{"rows"')).toBe(true);
  });

  it('leaves non-JSON output untouched', async () => {
    const plain = `ERROR at line 1\n${'trace line\n'.repeat(3000)}`;

    const spilled = await spill(plain);

    expect(spilled.preview.startsWith('ERROR at line 1')).toBe(true);
  });

  it('tells the model the preview may already answer the question', async () => {
    const spilled = await spill(JSON.stringify({ content: 'x'.repeat(60_000) }));

    expect(spilled.payload).toContain('only if the preview does not already answer');
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 1200-char preview budget`, async () => {
      const value = buildBoundaryStraddlingText(TOOL_OUTPUT_SPILL_PREVIEW_CHARS, cluster, 3000);
      const spilled = await spill(value);
      expectGraphemeSafe(spilled.preview);
      // preview is truncateGraphemesWithSuffix(value, TOOL_OUTPUT_SPILL_PREVIEW_CHARS, '…').
      expect(endsOnGraphemeBoundary(value, spilled.preview.slice(0, -'…'.length))).toBe(true);
    });
  }
});
