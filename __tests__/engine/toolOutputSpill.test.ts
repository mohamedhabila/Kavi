import {
  maybeSpillToolOutput,
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
    expect(mockedWrite).toHaveBeenCalledWith(
      'conv-1',
      '.kavi/spill/read_file-42.txt',
      result,
    );
    expect(spilled.preview.length).toBeLessThanOrEqual(TOOL_OUTPUT_SPILL_PREVIEW_CHARS + 1);
    expect(JSON.parse(spilled.payload)).toEqual(
      expect.objectContaining({
        status: 'spilled',
        path: '.kavi/spill/read_file-42.txt',
        preview: spilled.preview,
      }),
    );
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
    expect(mockedWrite).toHaveBeenCalledWith(
      'conv-1',
      '.kavi/spill/tool_catalog-42.txt',
      result,
    );
  });
});
