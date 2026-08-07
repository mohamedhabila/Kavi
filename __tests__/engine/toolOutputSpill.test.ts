import { DEFAULT_FETCH_MAX_CHARS } from '../../src/engine/tools/web-fetch';
import {
  maybeSpillToolOutput,
  resolveToolOutputSpillByteThreshold,
  TOOL_OUTPUT_DISCOVERY_SPILL_BYTE_THRESHOLD,
  TOOL_OUTPUT_SPILL_BYTE_THRESHOLD,
  TOOL_OUTPUT_SPILL_PREVIEW_CHARS,
} from '../../src/engine/tools/toolOutputSpill';
import { writeConversationWorkspaceTextFile } from '../../src/services/conversationWorkspace/files';

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
    const result = 'x'.repeat(TOOL_OUTPUT_SPILL_BYTE_THRESHOLD + 64);
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
          output: `Verified worker report ${'x'.repeat(TOOL_OUTPUT_SPILL_BYTE_THRESHOLD)}`,
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
      padding: 'x'.repeat(TOOL_OUTPUT_SPILL_BYTE_THRESHOLD + 64),
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
      padding: 'x'.repeat(TOOL_OUTPUT_DISCOVERY_SPILL_BYTE_THRESHOLD + 64),
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

describe('spill threshold for caller-bounded content tools', () => {
  it('keeps a default-sized web_fetch window inline', () => {
    // Spilling a result the caller already bounded costs a read_file round-trip and an
    // extra model turn without saving any tokens — the model needs the content either
    // way. Traced on device: two fetches produced two spill files and two extra reads.
    expect(resolveToolOutputSpillByteThreshold('web_fetch')).toBeGreaterThanOrEqual(
      DEFAULT_FETCH_MAX_CHARS,
    );
  });

  it('keeps web_fetch above the general threshold', () => {
    expect(resolveToolOutputSpillByteThreshold('web_fetch')).toBeGreaterThan(
      TOOL_OUTPUT_SPILL_BYTE_THRESHOLD,
    );
  });

  it('still spills a genuinely oversized multi-page fetch', () => {
    expect(resolveToolOutputSpillByteThreshold('web_fetch')).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(resolveToolOutputSpillByteThreshold('web_fetch'))).toBe(true);
  });

  it('leaves unbounded tools on the general threshold', () => {
    expect(resolveToolOutputSpillByteThreshold('python')).toBe(TOOL_OUTPUT_SPILL_BYTE_THRESHOLD);
    expect(resolveToolOutputSpillByteThreshold('ssh_exec')).toBe(TOOL_OUTPUT_SPILL_BYTE_THRESHOLD);
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
    const article = `Titan has a mean radius of 2,574.73 km. ${'body '.repeat(4000)}`;
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
    const spilled = await spill(JSON.stringify({ content: 'x'.repeat(20_000) }));

    expect(spilled.payload).toContain('only if the preview does not already answer');
  });
});
